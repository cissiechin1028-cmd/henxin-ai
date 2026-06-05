const { generateAIResponse } = require("./services/ai");
const { retrieveCases } = require("./services/caseRetriever");
const { generateProResponse } = require("./services/proEngine");
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
  SCREENSHOT: "screenshot",
  DRAFT_CHECK: "draft_check",
  CONSULT: "consult"
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

function isGreeting(text = "") {
  const t = String(text).trim().toLowerCase();

  return /^(おはよう|おはようございます|こんにちは|こんばんは|お疲れ様|お疲れ様です|はじめまして|よろしく|よろしくお願いします|hello|hi|早安|你好|晚上好)$/i.test(t);
}

function detectGreetingReplyWord(text = "") {
  const t = String(text).trim();

  if (/おはよう|早安/.test(t)) return "おはようございます";
  if (/こんばんは|晚上好/.test(t)) return "こんばんは";
  if (/お疲れ/.test(t)) return "お疲れ様です";
  if (/よろしく/.test(t)) return "よろしくお願いします";
  if (/你好|こんにちは|hello|hi|はじめまして/i.test(t)) return "こんにちは";

  return "こんにちは";
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

名前・電話番号・住所・メールアドレス・勤務先などは削除してから送ってください😊`;
}

function buildGreetingReply(text = "") {
  const greeting = detectGreetingReplyWord(text);

  return `${greeting}😊

気になるLINEを送ってください。

📷 LINEスクショ
✍️ 送る前チェック
💬 恋愛相談

どれでも大丈夫です。`;
}

function buildAskForScreenshotReply() {
  return `📷 LINEスクショを送ってください😊

直近のやり取りが見える1枚で大丈夫です。
目安は最後の5〜10通くらいです。

※名前・電話番号・住所など個人情報が見える場合は、隠してから送ってください。`;
}

function buildAskForDraftLineReply(hasContext = false) {
  if (hasContext) {
    return `送ろうと思っているLINEをそのまま送ってください😊

さっきのやり取りを踏まえて、
その一言が自然かどうか見ます。`;
  }

  return `送ろうと思っているLINEをそのまま送ってください😊

前後の流れがある場合は、
先にLINEスクショを送るとより正確に見れます。

例：
「また連絡してね」`;
}

function buildAskForConsultReply() {
  return `相談内容を送ってください😊

返信を正確に見たい場合は、
直近のLINEスクショか、最後のやり取りも一緒に送ってください。`;
}

function buildAskForLineReply() {
  return `その状況だけだと、まだ判断しすぎない方がいいかも。

最後に相手から来たLINEか、
LINEスクショを送ってください。

その流れを見た方が、
どう返すのが自然かちゃんと出せます。`;
}

function buildResetReply() {
  return `今の相談内容をリセットしたよ😊

新しい相談を送ってね。`;
}

function buildImageOnlyReply() {
  return `画像を送ってください😊

直近のやり取りが見えるLINEスクショ1枚で大丈夫です。`;
}

function buildHardPaywallReply(userId) {
  const checkoutUrl = buildCheckoutUrl(userId);

  const text = `無料相談は終了しました。

Proでは、LINEの返信相談を何度でも使えます。

・LINEスクショから返信提案
・送る前のLINEチェック
・続き相談
・前回までの流れを踏まえた返信

月額 ¥980（税込）`;

  if (checkoutUrl) {
    return `${text}

続きを見る👇
${checkoutUrl}`;
  }

  return `${text}

続きを見る`;
}

function buildOpenGuide(userId) {
  const checkoutUrl = buildCheckoutUrl(userId);

  if (checkoutUrl) {
    return `開通はこちら👇
${checkoutUrl}

開通後、もう一度メッセージを送ってください。`;
  }

  return "開通リンクは準備中です。";
}

function attachContinueHint(text, count) {
  if (count === 1) {
    return `${text}

※無料相談はあと2回です。`;
  }

  if (count === 2) {
    return `${text}

※無料相談はあと1回です。`;
  }

  if (count === FREE_LIMIT) {
    return `${text}

※今回で無料相談は終了です。

Proでは、返信相談を何度でも使えます。

月額 ¥980（税込）

__SHOW_PAY_BUTTON__`;
  }

  return text;
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

function deriveConversationRules(input = "", user = {}) {
  const t = String(input).trim();

  let contactAllowed = user.contactAllowed;
  let recommendedAction = user.recommendedAction;
  let mainRisk = user.mainRisk;

  if (/しばらく連絡しないで|連絡しないで|距離を置きたい|距離置きたい|今は話したくない|一人にして|放っておいて/.test(t)) {
    contactAllowed = false;
    recommendedAction = "wait";
    mainRisk = "push_too_hard";
  } else if (/忙しい|バタバタ|返信遅い|既読無視|未読無視|冷たい|そっけない|距離を感じる/.test(t)) {
    contactAllowed = true;
    recommendedAction = "soft_reply";
    mainRisk = "pressure";
  } else if (/喧嘩|怒ってる|怒らせた|言いすぎた|責めた|傷つけた/.test(t)) {
    contactAllowed = true;
    recommendedAction = "cool_down";
    mainRisk = "escalation";
  } else if (/別れたい|別れよう|別れた|振られた|復縁したい|戻りたい/.test(t)) {
    contactAllowed = false;
    recommendedAction = "reduce_pressure";
    mainRisk = "begging";
  } else if (/浮気|怪しい|他に好きな人|他の人|女の影|男の影/.test(t)) {
    contactAllowed = true;
    recommendedAction = "observe";
    mainRisk = "accusation";
  }

  return {
    contactAllowed,
    recommendedAction,
    mainRisk
  };
}

function detectFollowupStage({ scenario = "normal", user = {}, input = "" }) {
  const usage = Number(user.replyUsageCount || user.usageCount || 0);
  const text = String(input || "");

  if (["breakup", "fight", "reunion"].includes(scenario)) {
    if (usage <= 2) return "cooldown";
    if (/返信|返事|戻って|話せる|普通|会話|仲直り/.test(text)) return "reconnect";
    return "observe";
  }

  if (["ignore", "cold"].includes(scenario)) {
    if (usage <= 2) return "wait";
    if (/返事|返信|話題|会話|向こうから/.test(text)) return "observe";
    return "soft_reconnect";
  }

  if (scenario === "flirt") {
    if (usage <= 2) return "approach_light";
    return "approach_check";
  }

  return "normal";
}

function buildFollowupInput({ user, input, followupStage = "normal" }) {
  return `会話状況:
${user.conversationSummary || "前回の相談内容あり"}

直近のLINE文脈:
${user.lastChatContext || "なし"}

前回の相談タイプ:
${user.lastInputType || "不明"}

前回のシナリオ:
${user.lastScenario || "normal"}

前回の注意:
${user.mainRisk || "なし"}

今回の会話段階:
${followupStage}

今回の質問:
${input}

これは前回の続きです。
前回と同じ説明を繰り返さず、今回の質問にだけ自然に答えてください。`;
}

function buildInputWithChatContext({ user, input, mode }) {
  if (!user.lastChatContext) return input;

  if (mode === MODES.DRAFT_CHECK) {
    return `直近のLINE文脈:
${user.lastChatContext}

ユーザーが送ろうとしているLINE:
${input}

このLINEを送っていいか、文脈に合わせて判断してください。`;
  }

  return `直近のLINE文脈:
${user.lastChatContext}

今回の入力:
${input}`;
}

async function buildContext(userId, input, forcedType = null) {
  const user = await getUser(userId);

  let inputType = forcedType || detectInputType(input, user);
  let aiInput = input;
  const isFollowup = inputType === "followup";

  const baseScenario = user.lastScenario || detectScenario(input);

  const followupStage = detectFollowupStage({
    scenario: baseScenario,
    user,
    input
  });

  if (isFollowup) {
    inputType = user.lastInputType || "situation";
    aiInput = buildFollowupInput({ user, input, followupStage });
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

  const fallbackRules = deriveConversationRules(aiInput, user);

  const rules = classification
    ? {
        contactAllowed: classification.contactAllowed,
        recommendedAction: classification.recommendedAction,
        mainRisk: classification.mainRisk
      }
    : fallbackRules;

  const scenario =
    classification?.scenario ||
    detectScenario(aiInput) ||
    user.lastScenario ||
    "normal";

  const riskLevel =
    classification?.riskLevel ||
    user.lastRiskLevel ||
    1;

  const referenceCases = retrieveCases(input, 3);

  return {
    user,
    inputType,
    aiInput,
    isFollowup,
    rules,
    scenario,
    riskLevel,
    referenceCases,
    followupStage
  };
}

async function generateFree(userId, input, forcedType = null) {
  const {
    user,
    inputType,
    aiInput,
    isFollowup,
    rules,
    scenario,
    riskLevel,
    referenceCases,
    followupStage
  } = await buildContext(userId, input, forcedType);

  const rawReply = await generateAIResponse({
    input: aiInput,
    userState: {
      inputType,
      scenario,
      context: {
        originalInput: input,
        entryMode: user.pendingMode,
        isFollowup,
        followupStage,
        lastInput: user.lastInput,
        lastInputType: user.lastInputType,
        lastScenario: user.lastScenario,
        lastAdvice: user.lastAdvice,
        lastRiskLevel: user.lastRiskLevel,
        conversationSummary: user.conversationSummary,
        lastChatContext: user.lastChatContext,
        contactAllowed: rules.contactAllowed,
        recommendedAction: rules.recommendedAction,
        mainRisk: rules.mainRisk,
        freeUsageCount: Number(user.usageCount || 0) + 1,
        referenceCases: JSON.stringify(referenceCases, null, 2)
      }
    }
  });

  const ai = naturalizeReply(rawReply);
  const updatedUser = await incrementReplyUsage(userId);
  const nextCount = Number(updatedUser.usageCount || 0);

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
    pendingMode: null,
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

  return attachContinueHint(ai, nextCount);
}

async function generatePro(userId, input, forcedType = null) {
  const {
    user,
    inputType,
    aiInput,
    isFollowup,
    rules,
    scenario,
    riskLevel,
    followupStage
  } = await buildContext(userId, input, forcedType);

  const rawProReply = await generateProResponse({
    input: aiInput,
    scenario,
    context: {
      originalInput: input,
      inputType,
      isFollowup,
      followupStage,
      conversationSummary: user.conversationSummary,
      lastChatContext: user.lastChatContext,
      lastAdvice: user.lastAdvice,
      contactAllowed: rules.contactAllowed,
      recommendedAction: rules.recommendedAction,
      mainRisk: rules.mainRisk
    }
  });

  const proReply = naturalizeReply(rawProReply);

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
        reply: proReply,
        scenario
      })
    : user.conversationSummary;

  await updateUser(userId, {
    pendingMode: null,
    lastInput: input,
    lastInputType: inputType,
    lastScenario: scenario,
    lastAdvice: proReply,
    lastRiskLevel: riskLevel,
    conversationSummary,
    contactAllowed: rules.contactAllowed,
    recommendedAction: rules.recommendedAction,
    mainRisk: rules.mainRisk
  });

  return proReply;
}

async function generateByPlan(userId, input, type, user) {
  if (user.plan === "pro") {
    return generatePro(userId, input, type);
  }

  return generateFree(userId, input, type);
}

async function handleMenuCommand(userId, input, user) {
  if (/^返信アドバイス$/i.test(input)) {
    await updateUser(userId, {
      pendingMode: MODES.DRAFT_CHECK,
      pendingClarify: false,
      pendingText: null
    });

    return `送ろうと思っている内容や、相手とのLINEスクショを送ってください😊

スクショでも文章でも大丈夫です👌

どう返すのが良いか、一緒に考えます。`;
  }

  if (/^相手の本音$/i.test(input)) {
    await updateUser(userId, {
      pendingMode: MODES.SCREENSHOT,
      pendingClarify: false,
      pendingText: null
    });

    return `LINEスクショ、または届いたメッセージを送ってください😊

本音や今の温度感を見ます。

どんな気持ちなのか、一緒に見てみます。`;
  }

  if (/^状況相談$/i.test(input)) {
    await updateUser(userId, {
      pendingMode: MODES.CONSULT,
      pendingClarify: false,
      pendingText: null
    });

    return `今の状況を教えてください😊

スクショでも文章でも大丈夫です👌

復縁、告白、既読無視など、
気になっていることをそのまま送ってください。

一緒に整理してみます。`;
  }

  if (/^(リセット)$/i.test(input)) {
    await resetConversationOnly(userId);
    return buildResetReply();
  }

  return null;
}

async function handlePendingMode(userId, input, user) {
  switch (user.pendingMode) {
    case MODES.SCREENSHOT:
      return buildImageOnlyReply();

    case MODES.DRAFT_CHECK: {
      const draftInput = user.lastChatContext
        ? `これは「送る前チェック」です。

直近のLINE文脈：
${user.lastChatContext}

ユーザーが送ろうとしているLINE：
${input}

やってほしいこと：
まず、このまま送っていいかを判断してください。
そのうえで、必要なら自然な言い方を提案してください。
ただの言い換えではなく、
・そのまま送っていいか
・少し変えた方がいいか
・送らない方がいいか
を自然な日本語で伝えてください。

必要なら、送るならどんな一言が自然かも提案してください。`
        : `これは「送る前チェック」です。

ユーザーが送ろうとしているLINE：
${input}

やってほしいこと：
まず、このまま送っていいかを判断してください。
そのうえで、必要なら自然な言い方を提案してください。
ただの言い換えではなく、
・そのまま送っていいか
・少し変えた方がいいか
・送らない方がいいか
を自然な日本語で伝えてください。

必要なら、送るならどんな一言が自然かも提案してください。`;

      return generateByPlan(userId, draftInput, "draft", user);
    }

    case MODES.CONSULT: {
      const type = detectInputType(input, user);

      if (shouldAskForLine(type, input)) {
        return buildAskForLineReply();
      }

      return generateByPlan(userId, input, type, user);
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
  const result = await analyzeLineScreenshot(imageBuffer);

  if (!result.success) {
    return result.reply;
  }

  const reply = naturalizeReply(result.reply);
  const updatedUser = await incrementReplyUsage(userId);
  const nextCount = Number(updatedUser.usageCount || 0);

  await updateUser(userId, {
    pendingMode: null,
    lastInput: "[LINEスクショ]",
    lastInputType: "chatlog",
    lastScenario: "normal",
    lastAdvice: reply,
    lastRiskLevel: 1,
    lastChatContext: result.chatContext || null,
    conversationSummary: result.chatContext || null
  });

  return attachContinueHint(reply, nextCount);
}

async function handleMessage(userId, text) {
  const input = String(text || "").trim();

  if (!input) {
    return buildGreetingReply();
  }

  if (input === "__reset__") {
    await resetUser(userId);
    return "リセットしました";
  }

  const user = await getUser(userId);

  if (!user.privacyAccepted) {
    return "__SHOW_AGREEMENT_BUTTON__";
  }

  const menuReply = await handleMenuCommand(userId, input, user);
  if (menuReply) return menuReply;

  if (isGreeting(input)) {
    return buildGreetingReply(input);
  }

  if (/^(開通|購入|支払い|続きを見る)$/i.test(input)) {
    return buildOpenGuide(userId);
  }

  if (/^(履歴削除|データ削除)$/i.test(input)) {
    await resetConversationOnly(userId);
    return "保存中の相談履歴を削除しました。";
  }

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

  return generateByPlan(userId, input, type, user);
}

module.exports = {
  handleMessage,
  handleImageMessage
};
