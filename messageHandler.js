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

/* 👇 続き判定 */
function isContinueRequest(text = "") {
  return /^(続き|つづき)$/.test(String(text).trim());
}

/* 👇 付费拦截 */
function buildPaywallReply() {
  return `この先の内容は有料でご案内しています。

・相手の本音
・この後どう動くか
・送るべき具体的な一文
・最適なタイミング

を含めて確認できます。

「Proで見る」と送るとご案内します。`;
}

/* 👇 免费限制 */
function buildLimitReply() {
  return `無料版で使える3回分はここまでです。

この先の詳しい判断や、
相手の本音・次の動き方はProで確認できます。

「続き」と送るとご案内します。`;
}

/* 👇 免费提示节奏 */
function attachContinueHint(text, count) {
  if (count === 1) {
    return `${text}

他の状況や、次にどう返すかもそのまま送ってください。`;
  }

  if (count === 2) {
    return `${text}

他にも気になる点や、
次にどう動くかもそのまま送ってください。

気になる場合は「続き」と送ると、
もう少し詳しく見れます。`;
  }

  if (count === 3) {
    return `${text}

今の情報でも方向は見えていますが、

ここからは出し方で印象が変わりやすいです。

「続き」と送ると、さらに詳しく見れます。`;
  }

  return text;
}

/* 👇 免费生成 */
async function generateFree(input, user) {
  if (user.count >= FREE_LIMIT) {
    return buildLimitReply();
  }

  const ai = await generateAIResponse({
    input,
    userState: {
      context: user.context
    }
  });

  user.count++;
  user.context.lastAdvice = ai;

  return attachContinueHint(ai, user.count);
}

/* 👇 主逻辑 */
async function handleMessage(userId, text) {
  const input = String(text || "").trim();

  if (!users[userId]) {
    users[userId] = createUser();
  }

  const user = users[userId];

  /* 👇 続き逻辑 */
  if (isContinueRequest(input)) {
    if (user.plan !== "pro") {
      return buildPaywallReply();
    }

    return generateProResponse(user.context);
  }

  /* 👇 用户已是Pro */
  if (user.plan === "pro") {
    return generateProResponse({
      input,
      context: user.context
    });
  }

  /* 👇 免费 */
  return generateFree(input, user);
}

module.exports = { handleMessage };
