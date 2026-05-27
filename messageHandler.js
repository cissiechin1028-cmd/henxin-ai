const { generateAIResponse } = require("./services/ai");
const { retrieveCases } = require("./services/caseRetriever");
const { generateProResponse } = require("./services/proEngine");
const { detectScenario } = require("./services/scenarioDetector");
const { classifyMessage } = require("./services/classifier");
const { updateConversationSummary } = require("./services/summarizer");
const {
  getUser,
  resetUser,
  updateUser,
  incrementReplyUsage
} = require("./userStore");

const FREE_LIMIT = 3;
const PRO_URL = process.env.PRO_URL || "";
const BASE_URL = process.env.BASE_URL || "";

function buildCheckoutUrl(userId) {
  if (BASE_URL) {
    return `${BASE_URL}/checkout?userId=${encodeURIComponent(userId)}`;
  }

  return PRO_URL;
}

function naturalizeReply(text = "") {
  return String(text || "")
    .replace(/【結論】/g, "")
    .replace(/結論[:：]/g, "")
    .replace(/理由[:：]/g, "")
    .replace(/おすすめ戦略[:：]/g, "")
    .replace(/今回のおすすめ[:：]/g, "")
    .replace(/送るタイミング[:：]/g, "")
    .replace(/送るLINE[:：]/g, "")
    .replace(/💬 送るなら[:：]/g, "送るなら、")
    .replace(/送るなら[:：]/g, "送るなら、")
    .replace(/注意[:：]/g, "")
    .replace(/⚠️ 注意[:：]/g, "")
    .replace(/⚠️/g, "")
    .replace(/次の動き[:：]/g, "")
    .replace(/積極プラン[:：]/g, "少し近づくなら、")
    .replace(/安全プラン[:：]/g, "今は保つなら、")
    .replace(/撤退プラン[:：]/g, "一度引くなら、")
    .replace(/・積極プラン[:：]/g, "・少し近づくなら、")
    .replace(/・安全プラン[:：]/g, "・今は保つなら、")
    .replace(/・撤退プラン[:：]/g, "・一度引くなら、")
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

function buildGreetingReply(text = "") {
  const greeting = detectGreetingReplyWord(text);

  return `${greeting}😊

相手から来たLINEや、
今の状況をそのまま送ってください。

そのまま使える返信を作ります。`;
}

function detectInputType(text = "", user = {}) {
  const t = String(text).trim();

  if (!t) return "unknown";

  if (/「.+」/.test(t)) return "partner";

  if (
    user.lastInput &&
    /^(続き|つづき|次|どうする|どうすれば|どうしたら|返事|大丈夫|まだ好き|復縁したい)$/i.test(t)
  ) {
    return "followup";
  }

  if (
    user.lastInput &&
    /(でも|なんか|気がする|かも|どうすれば|どうしたら|わからない|分からない|大丈夫|まだ好き|復縁|戻りたい|浮気|怪しい|不安|怖い|心配|嫌われた|終わり|待った方がいい|待つ|どれくらい|タイミング|脈あり|脈なし)/.test(t)
  ) {
    return "followup";
  }

  if (/相手から|相手のメッセージ|相手に言われた|彼から|彼女から/.test(t)) {
    return "situation";
  }

  if (/どう返せば|なんて返せば|返信したい|返事したい|どう思う|相談|どうしよ|不安/.test(t)) {
    return "situation";
  }

  if (/復縁したい|戻りたい|告白したい|誘いたい|会いたい/.test(t)) {
    return "situation";
  }

  if (/返信|既読|未読|無視|冷たい|距離|別れ|復縁|浮気|怪しい|喧嘩|ブロック|好き|告白|誘い|デート|連絡|LINE|脈あり|脈なし/.test(t)) {
    return "situation";
  }

  if (t.length <= 2) return "unknown";

  if (t.length <= 20) return "partner";

  return "situation";
}

function isHighIntentInput(text = "") {
  const t = String(text).trim();

  return /復縁|戻りたい|浮気|怪しい|別れ|別れそう|ブロック|既読無視|未読無視|脈なし|冷たい|距離|喧嘩|嫌われた|終わり/.test(t);
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

function buildFollowupInput({ user, input }) {
  const summary = user.conversationSummary || "";

  return `会話状況:
${summary || "前回の相談内容あり"}

前回の相談タイプ:
${user.lastInputType || "不明"}

前回のシナリオ:
${user.lastScenario || "normal"}

前回の注意:
${user.mainRisk || "なし"}

今回の質問:
${input}

これは前回の続きです。
前回と同じ説明を繰り返さず、今回の質問にだけ自然に答えてください。`;
}

function buildClarifyReply() {
  return `これ、どっちですか？

① 相手から来たLINE
② 今の状況`;
}

function buildHardPaywallReply(userId) {
  const checkoutUrl = buildCheckoutUrl(userId);

  if (checkoutUrl) {
    return `ここから先は、相手の返事や状況に合わせて
次の動き方をもう少し丁寧に見ていけます。

Proでは、

・今送るべきか
・どれくらい待つべきか
・送るならどの一言が自然か
・避けた方がいい返し方

まで確認できます。

続きを見る👇
${checkoutUrl}`;
  }

  return `ここから先は、相手の返事や状況に合わせて
次の動き方をもう少し丁寧に見ていけます。

Proでは、

・今送るべきか
・どれくらい待つべきか
・送るならどの一言が自然か
・避けた方がいい返し方

まで確認できます。

続きを見る`;
}

function buildOpenGuide(userId) {
  const checkoutUrl = buildCheckoutUrl(userId);

  if (checkoutUrl) {
    return `開通はこちら👇
${checkoutUrl}

開通後、もう一度メッセージを送ってください。`;
  }

  return `開通リンクは準備中です。`;
}

function attachContinueHint(text, count) {
  if (count === 3) {
    return `${text}

ここから先はProで確認できます。

Proで解放：
・相手の本音分析
・今の距離感
・やってはいけない行動
・自然な返信例
・送るタイミング
・次どう動くべきか

料金：
月額 ¥980（税込）

__SHOW_PAY_BUTTON__`;
  }

  return text;
}

async function buildContext(userId, input, forcedType = null) {
  const user = await getUser(userId);

  let inputType = forcedType || detectInputType(input, user);
  let aiInput = input;
  const isFollowup = inputType === "followup";

  if (isFollowup) {
    inputType = user.lastInputType || "situation";
    aiInput = buildFollowupInput({ user, input });
  }

  // =========================
  // GPT classifier 降调用优化
  // =========================
  let classification = null;

  const shouldUseAIClassifier =
    isFollowup ||
    aiInput.length > 250 ||
    inputType === "unknown";

  if (shouldUseAIClassifier) {
    classification = await classifyMessage({
      input: aiInput,
      user
    });
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
    user.lastScenario ||
    detectScenario(aiInput);

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
    classification,
    rules,
    scenario,
    riskLevel,
    referenceCases
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
    referenceCases
  } = await buildContext(userId, input, forcedType);

  const rawReply = await generateAIResponse({
    input: aiInput,
    userState: {
      inputType,
      scenario,
      context: {
        originalInput: input,
        isFollowup,
        lastInput: user.lastInput,
        lastInputType: user.lastInputType,
        lastScenario: user.lastScenario,
        lastAdvice: user.lastAdvice,
        lastRiskLevel: user.lastRiskLevel,
        conversationSummary: user.conversationSummary,
        contactAllowed: rules.contactAllowed,
        recommendedAction: rules.recommendedAction,
        mainRisk: rules.mainRisk,
        freeUsageCount: user.usageCount + 1,
        referenceCases: JSON.stringify(referenceCases, null, 2)
      }
    }
  });

  const ai = naturalizeReply(rawReply);

  const updatedUser = await incrementReplyUsage(userId);
  const nextCount = updatedUser.usageCount;

  const shouldUpdateSummary =
    isFollowup ||
    aiInput.length >= 300 ||
    String(user.conversationSummary || "").length > 0;

  const conversationSummary = shouldUpdateSummary
    ? await updateConversationSummary({
        previousSummary: user.conversationSummary,
        input: input,
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
    riskLevel
  } = await buildContext(userId, input, forcedType);

  const rawProReply = await generateProResponse({
    input: aiInput,
    scenario,
    context: {
      originalInput: input,
      isFollowup,
      conversationSummary: user.conversationSummary,
      lastAdvice: user.lastAdvice,
      contactAllowed: rules.contactAllowed,
      recommendedAction: rules.recommendedAction,
      mainRisk: rules.mainRisk
    }
  });

  const proReply = naturalizeReply(rawProReply);

  const shouldUpdateSummary =
    isFollowup ||
    aiInput.length >= 300 ||
    String(user.conversationSummary || "").length > 0;

  const conversationSummary = shouldUpdateSummary
    ? await updateConversationSummary({
        previousSummary: user.conversationSummary,
        input: input,
        reply: proReply,
        scenario
      })
    : user.conversationSummary;

  await updateUser(userId, {
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

async function handleMessage(userId, text) {
  const input = String(text || "").trim();

  if (!input) {
    return buildClarifyReply();
  }

  if (input === "__reset__") {
    await resetUser(userId);
    return "リセットしました";
  }

  if (/^(履歴削除|データ削除)$/i.test(input)) {
    await resetUser(userId);
    return "保存中の相談履歴を削除しました。";
  }

  const user = await getUser(userId);

  if (!user.privacyAccepted) {
    return `ご利用前に、以下の内容への同意が必要です。

・18歳以上であること
・利用規約
・プライバシーポリシー
・返金ポリシー

同意するボタンを押してください。`;
  }

  if (isGreeting(input)) {
    return buildGreetingReply(input);
  }

  if (/^(開通|購入|支払い|続きを見る)$/i.test(input)) {
    return buildOpenGuide(userId);
  }

  if (user.pendingClarify) {
    const original = user.pendingText || input;

    await updateUser(userId, {
      pendingClarify: false,
      pendingText: null
    });

    if (/^(1|①)$/i.test(input)) {
      return generateFree(userId, original, "partner");
    }

    if (/^(2|②)$/i.test(input)) {
      return generateFree(userId, original, "situation");
    }

    return generateFree(userId, original, "situation");
  }

  if (user.plan !== "pro" && user.usageCount >= FREE_LIMIT) {
    await updateUser(userId, {
      paywall: true
    });

    return buildHardPaywallReply(userId);
  }

  const type = detectInputType(input, user);

  if (type === "unknown") {
    await updateUser(userId, {
      pendingClarify: true,
      pendingText: input
    });

    return buildClarifyReply();
  }

  if (user.plan === "pro") {
    return generatePro(userId, input, type);
  }

  return generateFree(userId, input, type);
}

module.exports = { handleMessage };
