const { generateAIResponse } = require("./services/ai");
const { detectScenario } = require("./services/scenarioDetector");
const {
  getUser,
  resetUser,
  updateUser,
  incrementReplyUsage
} = require("./userStore");

const FREE_LIMIT = 3;
const PRO_URL = process.env.PRO_URL || "";

/* ========= 打招呼 ========= */

function isGreeting(text = "") {
  const t = String(text).trim().toLowerCase();
  return /^(おはよう|おはようございます|こんにちは|こんばんは|お疲れ様|お疲れ様です|hello|hi)$/i.test(t);
}

function detectGreetingWord(text = "") {
  if (/おはよう/.test(text)) return "おはようございます";
  if (/こんばんは/.test(text)) return "こんばんは";
  if (/こんにちは/.test(text)) return "こんにちは";
  if (/お疲れ/.test(text)) return "お疲れ様です";
  return "こんにちは";
}

function buildGreetingReply(text = "") {
  const g = detectGreetingWord(text);
  return `${g}😊

相手から来たLINEや、
今の状況をそのまま送ってください。

そのまま使える返信を作ります。`;
}

/* ========= 输入类型 ========= */

function detectInputType(text = "") {
  if (/「.+」/.test(text)) return "partner";
  if (/どう返せば|相談|不安|どうすれば/.test(text)) return "situation";
  return "situation";
}

/* ========= 引导 ========= */

function attachHint(text, count) {
  if (count === 1) {
    return `${text}

👉 相手の返事をそのまま送ると、次の一手も出せます。`;
  }

  if (count === 2) {
    return `${text}

👉 このままの流れでどう動くべきかも見れます。`;
  }

  if (count === 3) {
    return `${text}

ここから先は、
「送るタイミング」と「次の一手」で結果が変わりやすいです。

👉 続きを見る場合は「続き」と送ってください。`;
  }

  return text;
}

/* ========= 付费 ========= */

function buildSoftPaywall() {
  return `ここから先は有料になります。

・今送るべきか
・どれくらい待つべきか
・次に送る一言

まで確認できます。

👉 「開通」と送ると進めます。`;
}

function buildHardPaywall() {
  return `続きは開通後に見れます。

👉 「開通」と送ってください。`;
}

function buildOpenGuide() {
  if (PRO_URL) {
    return `開通はこちら👇
${PRO_URL}

開通後、もう一度メッセージを送ってください。`;
  }
  return `開通リンクは準備中です。`;
}

/* ========= 核心 ========= */

async function generateFree(userId, input) {
  const user = getUser(userId);

  const scenario = detectScenario(input);

  const ai = await generateAIResponse({
    input,
    userState: {
      inputType: detectInputType(input),
      scenario,
      context: {}
    }
  });

  const updated = incrementReplyUsage(userId);
  const count = updated.usageCount;

  updateUser(userId, {
    lastInput: input
  });

  return attachHint(ai, count);
}

/* ========= 主逻辑 ========= */

async function handleMessage(userId, text) {
  const input = String(text || "").trim();
  if (!input) return "内容を送ってください";

  const user = getUser(userId);

  /* reset */
  if (input === "__reset__") {
    resetUser(userId);
    return "リセットしました";
  }

  /* 打招呼 */
  if (isGreeting(input)) {
    return buildGreetingReply(input);
  }

  /* 开通 */
  if (/^(開通|購入|支払い)$/i.test(input)) {
    return buildOpenGuide();
  }

  /* ⭐ 新问题 → 自动解锁 */
  if (
    user.lastInput &&
    input !== user.lastInput &&
    !/^(続き|つづき)$/i.test(input)
  ) {
    updateUser(userId, {
      usageCount: 0,
      paywall: false
    });
  }

  /* ⭐ 続き触发收费 */
  if (/^(続き|つづき)$/i.test(input)) {
    updateUser(userId, { paywall: true });
    return buildSoftPaywall();
  }

  /* ⭐ 已进入付费区 */
  if (user.paywall) {
    return buildHardPaywall();
  }

  /* ⭐ 正常免费流程 */
  if (user.usageCount >= FREE_LIMIT) {
    updateUser(userId, { paywall: true });
    return buildSoftPaywall();
  }

  return generateFree(userId, input);
}

module.exports = { handleMessage };
