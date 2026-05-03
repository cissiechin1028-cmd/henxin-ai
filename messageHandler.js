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

/* =========================
   打招呼识别
========================= */
function isGreeting(text = "") {
  const t = String(text).trim().toLowerCase();

  return /^(おはよう|おはようございます|こんにちは|こんばんは|お疲れ様|お疲れ様です|はじめまして|よろしく|よろしくお願いします|hello|hi)$/i.test(
    t
  );
}

/* =========================
   打招呼内容匹配
========================= */
function detectGreetingWord(text = "") {
  const t = String(text).trim();

  if (/おはよう|おはようございます/.test(t)) return "おはようございます";
  if (/こんばんは/.test(t)) return "こんばんは";
  if (/こんにちは/.test(t)) return "こんにちは";
  if (/お疲れ|お疲れ様/.test(t)) return "お疲れ様です";

  return "こんにちは";
}

/* =========================
   打招呼回复
========================= */
function buildGreetingReply(text = "") {
  const greeting = detectGreetingWord(text);

  return `${greeting}😊

相手から来たLINEや、
今の状況をそのまま送ってください。

そのまま使える返信を作ります。`;
}

/* =========================
   输入类型判断
========================= */
function detectInputType(text = "", user = {}) {
  const t = String(text).trim();

  if (!t) return "unknown";

  if (/「.+」/.test(t)) return "partner";

  if (/どう返せば|なんて返せば|返信したい|相談|不安/.test(t)) {
    return "situation";
  }

  if (/復縁したい|告白したい|誘いたい/.test(t)) {
    return "situation";
  }

  if (/返信|既読|未読|冷たい|距離|別れ|復縁|浮気|怪しい/.test(t)) {
    return "situation";
  }

  if (user.lastInput && /^(続き|次|どうする)$/i.test(t)) {
    return "followup";
  }

  if (t.length <= 2) return "unknown";

  if (t.length <= 20) return "partner";

  return "situation";
}

/* =========================
   Clarify
========================= */
function buildClarifyReply() {
  return `これ、どっちですか？

① 相手から来たLINE
② 今の状況`;
}

/* =========================
   付费提示（软）
========================= */
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

/* =========================
   付费提示（硬）
========================= */
function buildHardPaywallReply() {
  return `この先では、

・相手の温度感
・次にどう動くか
・送るタイミング
・そのまま使える返信

まで確認できます。

続きを見る`;
}

/* =========================
   Hint
========================= */
function attachContinueHint(text, count) {
  if (count === 1) return text;

  if (count === 2) {
    return `${text}

※この状況は、次の一言で相手の温度が変わりやすいです。
「続き」と送ると、次に送るべき一言まで見れます。`;
  }

  if (count === 3) {
    return `${text}

ここから先は、
“いつ送るか”で結果が変わりやすいです。`;
  }

  return text;
}

/* =========================
   免费生成
========================= */
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
        lastAdvice: user.lastAdvice
      }
    }
  });

  const updatedUser = incrementReplyUsage(userId);
  const count = updatedUser.usageCount;

  updateUser(userId, {
    lastInput: input,
    lastInputType: inputType,
    lastScenario: scenario,
    lastAdvice: ai
  });

  /* 第3次开始带 Pro */
  if (count === 3) {
    const pro = generateProResponse(input, scenario);
    return attachContinueHint(ai + "\n\n＝＝＝＝＝＝＝＝＝＝\n" + pro, count);
  }

  return attachContinueHint(ai, count);
}

/* =========================
   主逻辑
========================= */
async function handleMessage(userId, text) {
  const input = String(text || "").trim();

  if (!input) return buildClarifyReply();

  if (input === "__reset__") {
    resetUser(userId);
    return "リセットしました";
  }

  const user = getUser(userId);

  /* 打招呼 */
  if (isGreeting(input)) {
    return buildGreetingReply(input);
  }

  /* 第4次 */
  if (user.usageCount === FREE_LIMIT) {
    updateUser(userId, {
      usageCount: user.usageCount + 1
    });
    return buildSoftLimitReply();
  }

  /* 第5次以后 */
  if (user.usageCount > FREE_LIMIT) {
    return buildHardPaywallReply();
  }

  /* Clarify */
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
