const { generateAIResponse } = require("./services/ai");
const { generateProResponse } = require("./services/proEngine");

let users = {};
const FREE_LIMIT = 3;

function createUser() {
  return {
    count: 0,
    plan: "free",
    pendingClarify: false,
    pendingText: null,
    context: {
      lastInput: null,
      lastInputType: null,
      lastScenario: null,
      lastAdvice: null
    }
  };
}

/* 打招呼识别 */
function isGreeting(text = "") {
  const t = String(text).trim().toLowerCase();
  return /^(おはよう|こんにちは|こんばんは|お疲れ|はじめまして|hello|hi|早安|你好|晚上好)/.test(t);
}

/* 打招呼回复 */
function buildGreetingReply() {
  return `こんにちは😊

相手から来たLINEや、
今の状況をそのまま送ってください。

そのまま使える返信を作ります。`;
}

/* 场景识别（保留） */
function detectScenario(text = "") {
  const t = String(text);

  if (/浮気|怪しい/.test(t)) return "cheating";
  if (/復縁|戻りたい/.test(t)) return "reunion";
  if (/別れ|もう無理/.test(t)) return "breakup";
  if (/返信こない|無視/.test(t)) return "ignore";
  if (/告白|誘いたい/.test(t)) return "flirt";
  if (/冷たい|距離/.test(t)) return "cold";

  return "normal";
}

/* 输入类型识别（保留） */
function detectInputType(text = "", context = {}) {
  const t = String(text).trim();

  if (!t) return "unknown";

  if (/「.+」/.test(t)) return "partner";

  if (/復縁したい|戻りたい|告白したい|誘いたい/.test(t)) {
    return "intent";
  }

  if (context.lastInput && /返事|どうする|次/.test(t)) {
    return "followup";
  }

  if (/どうしよ|微妙|無理|不安/.test(t)) {
    return "situation";
  }

  if (t.length <= 10) return "unknown";

  return "situation";
}

function updateContext(user, input, type, scenario, advice = null) {
  user.context.lastInput = input;
  user.context.lastInputType = type;
  user.context.lastScenario = scenario;
  if (advice) user.context.lastAdvice = advice;
}

function buildClarifyReply() {
  return `これ、どっちですか？

① 相手から来たLINE
② 今の状況`;
}

/* 第4次 */
function buildSoftLimitReply() {
  return `今は、無理に踏み込まず少し距離を保つのが安全です。

無料版で使える3回分はここまでです。

この先の具体的な動き方や、
送るタイミングはProで確認できます。

Pro（月額¥980）で続きを見る`;
}

/* 第5次以后 */
function buildHardPaywallReply() {
  return `この先はProでご案内しています。

・相手の本音
・次にどう動くか
・送るタイミング
・そのまま使える返信

を確認できます。

Pro（月額¥980）で続きを見る`;
}

/* 免费节奏 */
function attachContinueHint(text, count) {
  if (count === 1) return text;

  if (count === 2) {
    return `${text}

※気になる場合は「続き」と送ると、もう少し詳しく見れます。`;
  }

  if (count === 3) {
    return `${text}

今の情報でも方向は見えていますが、
出し方次第で結果が変わりやすい段階です。

「続き」でこの後の動きも見れます。`;
  }

  return text;
}

/* 免费生成（保留原逻辑，仅加节奏） */
async function generateFree(input, user, forcedType = null) {
  const inputType = forcedType || detectInputType(input, user.context);
  const scenario = detectScenario(input);

  const ai = await generateAIResponse({
    input,
    userState: {
      inputType,
      scenario,
      context: user.context
    }
  });

  user.count++;
  updateContext(user, input, inputType, scenario, ai);

  return attachContinueHint(ai, user.count);
}

/* 主逻辑 */
async function handleMessage(userId, text) {
  const input = String(text || "").trim();

  if (!users[userId]) {
    users[userId] = createUser();
  }

  const user = users[userId];

  if (input === "__reset__") {
    users[userId] = createUser();
    return "リセットしました";
  }

  if (isGreeting(input)) {
    return buildGreetingReply();
  }

  /* 第4次 */
  if (user.count === FREE_LIMIT) {
    user.count++;
    return buildSoftLimitReply();
  }

  /* 第5次以后 */
  if (user.count > FREE_LIMIT) {
    return buildHardPaywallReply();
  }

  if (user.pendingClarify) {
    const original = user.pendingText;
    user.pendingClarify = false;

    if (/^(1|①)$/i.test(input)) {
      return generateFree(original, user, "partner");
    }

    if (/^(2|②)$/i.test(input)) {
      return generateFree(original, user, "situation");
    }

    return generateFree(original, user, "situation");
  }

  const type = detectInputType(input, user.context);

  if (type === "unknown") {
    user.pendingClarify = true;
    user.pendingText = input;
    return buildClarifyReply();
  }

  return generateFree(input, user, type);
}

module.exports = { handleMessage };
