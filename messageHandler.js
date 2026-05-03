const { generateAIResponse } = require("./services/ai");
const { generateProResponse } = require("./services/proEngine");
const { detectScenario } = require("./services/scenarioDetector");
const {
  getUser,
  resetUser,
  updateUser,
  incrementReplyUsage
} = require("./userStore");

const FREE_LIMIT = 3;
const PRO_URL = process.env.PRO_URL || "";

function isGreeting(text = "") {
  const t = String(text).trim().toLowerCase();

  return /^(おはよう|おはようございます|こんにちは|こんばんは|お疲れ様|お疲れ様です|はじめまして|よろしく|よろしくお願いします|hello|hi|早安|你好|晚上好)$/i.test(t);
}

function buildGreetingReply() {
  return `こんにちは😊

相手から来たLINEや、
今の状況をそのまま送ってください。

そのまま使える返信を作ります。`;
}

function detectInputType(text = "", user = {}) {
  const t = String(text).trim();

  if (!t) return "unknown";

  if (/「.+」/.test(t)) return "partner";

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

  if (user.lastInput && /^(続き|つづき|次|どうする|返事)$/i.test(t)) {
    return "followup";
  }

  if (t.length <= 2) return "unknown";

  if (t.length <= 20) return "partner";

  return "situation";
}

function buildClarifyReply() {
  return `これ、どっちですか？

① 相手から来たLINE
② 今の状況`;
}

function buildSoftLimitReply() {
  return `ここから先は、
送る内容だけでなく「送るタイミング」も大事です。

この先では、

・今送るべきか
・何時間空けるべきか
・送るならどの一言が安全か

まで確認できます。

続きを見る`;
}

function buildHardPaywallReply() {
  return `この先では、

・相手の温度感
・次にどう動くか
・送るタイミング
・そのまま使える返信

まで確認できます。

続きを見る`;
}

function buildOpenGuide() {
  if (PRO_URL) {
    return `開通はこちら👇
${PRO_URL}

開通後、もう一度メッセージを送ってください。`;
  }

  return `開通リンクは準備中です。`;
}

function attachContinueHint(text, count) {
  if (count === 1) {
    return text;
  }

  if (count === 2) {
    return `${text}

※この状況は、次の一言で相手の温度が変わりやすいです。
「続き」と送ると、次に送るべき一言まで見れます。`;
  }

  if (count === 3) {
    return `${text}

ここから先は、送る内容よりも
“いつ送るか”で結果が変わりやすいです。

続きを見る`;
  }

  return text;
}

async function generateFree(userId, input, forcedType = null) {
  const user = getUser(userId);

  let inputType = forcedType || detectInputType(input, user);

  if (inputType === "followup") {
    inputType = user.lastInputType || "situation";
    input = user.lastInput || input;
  }

  const scenario = detectScenario(input);

  const ai = await generateAIResponse({
    input,
    userState: {
      inputType,
      scenario,
      context: {
        lastInput: user.lastInput,
        lastInputType: user.lastInputType,
        lastScenario: user.lastScenario,
        lastAdvice: user.lastAdvice,
        lastRiskLevel: user.lastRiskLevel
      }
    }
  });

  const updatedUser = incrementReplyUsage(userId);
  const nextCount = updatedUser.usageCount;

  updateUser(userId, {
    lastInput: input,
    lastInputType: inputType,
    lastScenario: scenario,
    lastAdvice: ai
  });

  return attachContinueHint(ai, nextCount);
}

async function handleMessage(userId, text) {
  const input = String(text || "").trim();

  if (!input) {
    return buildClarifyReply();
  }

  if (input === "__reset__") {
    resetUser(userId);
    return "リセットしました";
  }

  let user = getUser(userId);

  if (isGreeting(input)) {
    return buildGreetingReply();
  }

  if (/^(開通|購入|支払い|続きを見る)$/i.test(input)) {
    return buildOpenGuide();
  }

  const isFollowup = /^(続き|つづき|次|どうする|返事)$/i.test(input);

  if (
    user.lastInput &&
    input !== user.lastInput &&
    !isFollowup
  ) {
    updateUser(userId, {
      usageCount: 0,
      paywall: false
    });

    user = getUser(userId);
  }

  if (user.pendingClarify) {
    const original = user.pendingText || input;

    updateUser(userId, {
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

  if (user.usageCount === FREE_LIMIT) {
    updateUser(userId, {
      usageCount: user.usageCount + 1,
      paywall: true
    });

    return buildSoftLimitReply();
  }

  if (user.usageCount > FREE_LIMIT || user.paywall) {
    return buildHardPaywallReply();
  }

  const type = detectInputType(input, user);

  if (type === "unknown") {
    updateUser(userId, {
      pendingClarify: true,
      pendingText: input
    });

    return buildClarifyReply();
  }

  return generateFree(userId, input, type);
}

module.exports = { handleMessage };
