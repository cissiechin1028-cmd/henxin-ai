const { generateAIResponse } = require("./services/ai");
const { detectScenario } = require("./services/scenarioDetector");
const { classifyMessage } = require("./services/classifier");
const { updateConversationSummary } = require("./services/summarizer");
const {
  getUser,
  resetUser,
  resetConversationOnly,
  updateUser,
  incrementReplyUsage
} = require("./userStore");

const FREE_LIMIT = 5;
const PRO_URL = process.env.PRO_URL || "";
const BASE_URL = process.env.BASE_URL || "";

const MODES = {
  REPLY: "reply",
  MIND: "mind",
  CONSULT: "consult",
  DELETE_CONFIRM: "delete_confirm"
};

function buildCheckoutUrl(userId) {
  if (BASE_URL) {
    return `${BASE_URL}/checkout?userId=${encodeURIComponent(userId)}`;
  }

  return PRO_URL;
}

function naturalizeReply(text = "") {
  return String(text || "")
    .replace(/【[^】]+】/g, "")
    .replace(/結論[:：]/g, "")
    .replace(/理由[:：]/g, "")
    .replace(/判断[:：]/g, "")
    .replace(/送るLINE[:：]/g, "")
    .replace(/注意[:：]/g, "")
    .replace(/⚠️/g, "")
    .replace(/---/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function containsPersonalInfo(text = "") {
  const t = String(text || "");

  return (
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(t) ||
    /0\d{1,4}[-ー]?\d{1,4}[-ー]?\d{3,4}/.test(t) ||
    /〒?\d{3}[-ー]\d{4}/.test(t) ||
    /(東京都|北海道|大阪府|京都府|.{2,3}県).{0,20}(市|区|町|村)/.test(t) ||
    /(LINE\s?ID|ラインID|Instagram|インスタ|住所|電話番号|勤務先|学校名)/i.test(t)
  );
}

function buildPrivacyWarningReply() {
  return `個人情報が含まれている可能性があります。

お名前・電話番号・住所・メールアドレス・勤務先などは削除したうえでお送りください。`;
}

function buildResetReply() {
  return `現在の相談内容をリセットしました😊

新しいご相談がありましたら、お送りください。`;
}

function buildDataDeleteConfirmReply() {
  return `保存中の相談履歴を削除します。

削除後は元に戻せません。

削除する場合は、

削除する

と送信してください。`;
}

function buildDataDeletedReply() {
  return `相談履歴を削除しました。

新しい相談はいつでも始められます。`;
}

function buildAskForLineReply() {
  return `その状況だけでは、正確に判断しすぎない方がよさそうです。

最後に相手から届いたLINE、または直近のLINEスクショをお送りください。

流れが分かると、より自然に見られます。`;
}

function buildHardPaywallReply(userId) {
  const checkoutUrl = buildCheckoutUrl(userId);

  const text = `無料相談は終了しました。

Proプランでは、返信くんを回数制限なくご利用いただけます。

・返信アドバイス
・相手の本音
・状況相談
・前回までの流れを踏まえた続き相談

月額 ¥980（税込）`;

  return `${text}

${checkoutUrl}`;
}

function attachContinueHint(text, count) {
  const remaining = FREE_LIMIT - count;

  if (remaining > 0) {
    return `${text}

※無料相談はあと${remaining}回です。`;
  }

  return `${text}

※今回で無料相談は終了です。

Proプランでは、返信くんを回数制限なくご利用いただけます。

月額 ¥980（税込）

__SHOW_PAY_BUTTON__`;
}

function hasQuotedLine(text = "") {
  return /「[^」]+」/.test(String(text || ""));
}

function looksLikeSituation(text = "") {
  const t = String(text || "");

  return /既読|未読|無視|返信ない|返事ない|冷たい|そっけない|返信遅い|距離|復縁|別れ|振られた|浮気|怪しい|喧嘩|怒ってる|謝りたい|脈あり|脈なし|好き|告白|誘いたい|会いたい|不安|どうすれば|どうしたら|どう思う|相談/.test(t);
}

function looksLikeChatlog(text = "") {
  const t = String(text || "");

  const hasSpeaker =
    /(^|\n)\s*(彼|彼氏|相手|向こう|私|自分)\s*[:：]/.test(t) ||
    /(^|\n)\s*(me|you|him|her)\s*[:：]/i.test(t);

  const quoteCount = (t.match(/「[^」]+」/g) || []).length;

  return t.includes("\n") && (hasSpeaker || quoteCount >= 2);
}

function looksLikeDraft(text = "") {
  const t = String(text || "");

  return /送ろうと思|送っていい|送るなら|これ送|こう返|返そうと思|返信しよう|この返信|この返し|これでいい|こう言おう|送る前チェック|送る前にチェック|私[:：]/.test(t);
}

function looksLikePartnerLine(text = "") {
  const t = String(text || "");

  if (/相手から|相手のLINE|相手に言われた|彼から|彼女から|向こうから/.test(t)) {
    return true;
  }

  if (/(^|\n)\s*(彼|彼氏|相手|向こう)\s*[:：]/.test(t)) {
    return true;
  }

  if (hasQuotedLine(t) && !looksLikeDraft(t)) {
    return true;
  }

  if (t.length <= 30 && !looksLikeSituation(t)) {
    return true;
  }

  return false;
}

function detectInputType(text = "", user = {}) {
  const t = String(text || "").trim();

  if (!t) return "unknown";

  if (
    user.lastInput &&
    /^(続き|つづき|次|どうする|どうすれば|どうしたら|返事|返信|大丈夫|まだ待つ|送っていい|これは？)$/i.test(t)
  ) {
    return "followup";
  }

  if (
    user.lastInput &&
    /(でも|じゃあ|それなら|まだ|次|返事|返信|送る|待つ|タイミング|大丈夫|どうすれば|どうしたら|これでいい|この場合)/.test(t)
  ) {
    return "followup";
  }

  if (looksLikeChatlog(t)) return "chatlog";
  if (looksLikeDraft(t)) return "draft";
  if (looksLikePartnerLine(t)) return "partner";
  if (looksLikeSituation(t)) return "situation";

  if (t.length <= 2) return "unknown";
  if (t.length <= 30) return "partner";

  return "situation";
}

function shouldAskForLine(inputType, text = "") {
  if (inputType !== "situation") return false;

  const t = String(text || "").trim();

  if (hasQuotedLine(t)) return false;
  if (looksLikeChatlog(t)) return false;
  if (looksLikeDraft(t)) return false;

  return true;
}

async function buildContext(userId, input, forcedType = null) {
  const user = await getUser(userId);

  let inputType = forcedType || detectInputType(input, user);
  let aiInput = input;
  const isFollowup = inputType === "followup";

  if (isFollowup) {
    inputType = user.lastInputType || "situation";

    aiInput = `会話状況:
${user.conversationSummary || "前回の相談内容あり"}

直近のLINE文脈:
${user.lastChatContext || "なし"}

前回の相談タイプ:
${user.lastInputType || "不明"}

前回のシナリオ:
${user.lastScenario || "normal"}

今回の質問:
${input}

これは前回の続きです。
前回と同じ説明を繰り返さず、今回の質問にだけ自然に答えてください。`;
  }

  let classification = null;

  const shouldUseAIClassifier =
    isFollowup ||
    aiInput.length > 220 ||
    inputType === "unknown";

  if (shouldUseAIClassifier) {
    classification = await classifyMessage({
      input: aiInput,
      user
    });
  }

  if (classification?.inputType && !forcedType && classification.inputType !== "unknown") {
    inputType = classification.inputType;
  }

  const scenario =
    classification?.scenario ||
    detectScenario(aiInput) ||
    user.lastScenario ||
    "normal";

  const riskLevel =
    classification?.riskLevel ||
    user.lastRiskLevel ||
    1;

  const rules = {
    contactAllowed: classification?.contactAllowed ?? user.contactAllowed,
    recommendedAction: classification?.recommendedAction ?? user.recommendedAction,
    mainRisk: classification?.mainRisk ?? user.mainRisk
  };

  return {
    user,
    inputType,
    aiInput,
    isFollowup,
    rules,
    scenario,
    riskLevel
  };
}

async function generateReply(userId, input, forcedType = null) {
  const {
    user,
    inputType,
    aiInput,
    isFollowup,
    rules,
    scenario,
    riskLevel
  } = await buildContext(userId, input, forcedType);

  const rawReply = await generateAIResponse({
    input: aiInput,
    userState: {
      inputType,
      scenario,
      context: {
        originalInput: input,
        entryMode: user.pendingMode || MODES.REPLY,
        isFollowup,
        lastInput: user.lastInput,
        lastInputType: user.lastInputType,
        lastScenario: user.lastScenario,
        lastAdvice: user.lastAdvice,
        lastRiskLevel: user.lastRiskLevel,
        conversationSummary: user.conversationSummary,
        lastChatContext: user.lastChatContext,
        contactAllowed: rules.contactAllowed,
        recommendedAction: rules.recommendedAction,
        mainRisk: rules.mainRisk
      }
    }
  });

  const ai = naturalizeReply(rawReply);

  let nextCount = Number(user.usageCount || 0);

  if (user.plan !== "pro") {
    const updatedUser = await incrementReplyUsage(userId);
    nextCount = Number(updatedUser.usageCount || 0);
  }

  const shouldUpdateSummary =
    isFollowup ||
    inputType === "chatlog" ||
    aiInput.length >= 400 ||
    riskLevel >= 3 ||
    user.plan === "pro";

  const conversationSummary = shouldUpdateSummary
    ? await updateConversationSummary({
        previousSummary: user.conversationSummary,
        input,
        reply: ai,
        scenario
      })
    : user.conversationSummary;

  await updateUser(userId, {
    lastInput: input,
    lastInputType: inputType,
    lastScenario: scenario,
    lastAdvice: ai,
    lastRiskLevel: riskLevel,
    conversationSummary,
    contactAllowed: rules.contactAllowed,
    recommendedAction: rules.recommendedAction,
    mainRisk: rules.mainRisk
  });

  if (user.plan === "pro") {
    return ai;
  }

  return attachContinueHint(ai, nextCount);
}

async function handleMenuCommand(userId, input) {
  if (/^返信アドバイス$/i.test(input)) {
    await updateUser(userId, {
      pendingMode: MODES.REPLY,
      pendingClarify: false,
      pendingText: null
    });

    return `送ろうと思っている内容や、相手とのLINEスクショを送ってください😊

スクショでも文章でも大丈夫です。

どう返すのがよいか、一緒に考えます。`;
  }

  if (/^相手の本音$/i.test(input)) {
    await updateUser(userId, {
      pendingMode: MODES.MIND,
      pendingClarify: false,
      pendingText: null
    });

    return `LINEスクショ、または届いたメッセージを送ってください😊

相手の本音や今の温度感を見ます。

どのような気持ちなのか、一緒に整理します。`;
  }

  if (/^状況相談$/i.test(input)) {
    await updateUser(userId, {
      pendingMode: MODES.CONSULT,
      pendingClarify: false,
      pendingText: null
    });

    return `今の状況を教えてください😊

スクショでも文章でも大丈夫です。

復縁、告白、既読無視など、気になっていることをそのままお送りください。

一緒に整理します。`;
  }

  if (/^データ削除$/i.test(input)) {
    await updateUser(userId, {
      pendingMode: MODES.DELETE_CONFIRM,
      pendingClarify: false,
      pendingText: null
    });

    return buildDataDeleteConfirmReply();
  }

  if (/^(リセット)$/i.test(input)) {
    await resetConversationOnly(userId);
    return buildResetReply();
  }

  return null;
}

function isMeaninglessInput(text = "") {
  const t = String(text || "").trim();

  return (
    !t ||
    /^(テスト|test|てすと|確認|あ|ん|笑|w|ｗ|？|\?|。)$/i.test(t) ||
    t.length <= 1
  );
}

async function handlePendingMode(userId, input, user) {
  
  if (isMeaninglessInput(input)) {
    return "LINEスクショや相談内容を送ってください😊";
  }

  switch (user.pendingMode) {
    case MODES.REPLY: {
      const replyInput = user.lastChatContext
        ? `これは「返信アドバイス」です。

直近のLINE文脈：
${user.lastChatContext}

ユーザーが送ろうとしている内容：
${input}

やってほしいこと：
どう返すのがよいかを判断し、必要ならそのまま送れる一言を提案してください。`
        : input;

      return generateReply(userId, replyInput, "draft");
    }

    case MODES.MIND: {
      return generateReply(userId, input, detectInputType(input, user));
    }

    case MODES.CONSULT: {
      const type = detectInputType(input, user);

      if (shouldAskForLine(type, input)) {
        return buildAskForLineReply();
      }

      return generateReply(userId, input, type);
    }

    default:
      return null;
  }
}

async function handleImageMessage(userId, imageBuffer) {
  const user = await getUser(userId);

  if (!user.privacyAccepted) {
    return "__SHOW_AGREEMENT_BUTTON__";
  }

  if (user.plan !== "pro" && Number(user.usageCount || 0) >= FREE_LIMIT) {
    await updateUser(userId, { paywall: true });
    return buildHardPaywallReply(userId);
  }

  const { analyzeLineScreenshot } = require("./services/imageAnalyzer");
  const entryMode = user.pendingMode || MODES.REPLY;

  const result = await analyzeLineScreenshot(imageBuffer, entryMode);

  if (!result.success) {
    return result.reply;
  }

  const chatContext = result.chatContext || "";

  if (!chatContext) {
    return "画像の内容をうまく読み取れませんでした。相手から来たLINEか、直近のやり取りをテキストで送ってください。";
  }

  const inputForAI = `これはLINEスクショから読み取った直近の会話です。

${chatContext}

現在の入口：
${entryMode}

この会話内容をもとに、現在の入口に合わせて答えてください。`;

  await updateUser(userId, {
    lastChatContext: chatContext,
    conversationSummary: chatContext
  });

  return generateReply(userId, inputForAI, "chatlog");
}

async function handleMessage(userId, text) {
  const input = String(text || "").trim();

  if (!input) {
    return "メニューから選択するか、そのまま相談内容をお送りください😊";
  }

  if (input === "__reset__") {
    await resetUser(userId);
    return "リセットしました。";
  }

  const user = await getUser(userId);

  if (!user.privacyAccepted) {
    return "__SHOW_AGREEMENT_BUTTON__";
  }

  if (user.pendingMode === MODES.DELETE_CONFIRM && /^削除する$/i.test(input)) {
    await resetConversationOnly(userId);
    return buildDataDeletedReply();
  }

  const menuReply = await handleMenuCommand(userId, input);
  if (menuReply) return menuReply;

  if (containsPersonalInfo(input)) {
    return buildPrivacyWarningReply();
  }

  if (user.plan !== "pro" && Number(user.usageCount || 0) >= FREE_LIMIT) {
    await updateUser(userId, { paywall: true });
    return buildHardPaywallReply(userId);
  }

  const pendingReply = await handlePendingMode(userId, input, user);
  if (pendingReply) return pendingReply;

  const type = detectInputType(input, user);

  if (shouldAskForLine(type, input)) {
    return buildAskForLineReply();
  }

  return generateReply(userId, input, type);
}

module.exports = {
  handleMessage,
  handleImageMessage
};
