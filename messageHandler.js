const { generateAIResponse } = require("./services/ai");
const { generateProResponse } = require("./services/proEngine");

let users = {};

// 🔴 高危判断
function isCritical(text = "") {
  return /復縁|別れ|無理|浮気|怪しい|距離置きたい|連絡しないで/.test(text);
}

// 🧠 场景判断（简单版）
function detectScenario(text) {
  if (/浮気|怪しい/.test(text)) return "cheating";
  if (/復縁|別れ/.test(text)) return "reunion";
  if (/既読/.test(text)) return "ignore";
  if (/好き|告白|誘いたい/.test(text)) return "flirt";
  if (/冷たい|距離/.test(text)) return "cold";
  return "normal";
}

// 🧠 免费输出结构（强制）
function buildFreeReply(aiText) {
  const lines = aiText.split("\n").filter(Boolean);
  let reply = lines.find(l => l.includes("「")) || "「最近どう？無理してない？」";

  return `今は、少し様子を見るのが自然です。

👇 送るなら
${reply}

⚠️ ここだけ注意
重くなると距離が広がりやすいです。`;
}

async function handleMessage(userId, text) {
  if (!users[userId]) {
    users[userId] = {
      count: 0,
      plan: "free"
    };
  }

  const user = users[userId];

  // 💰 已付费用户
  if (user.plan === "pro") {
    const scenario = detectScenario(text);
    return generateProResponse(text, scenario);
  }

  // 🔴 高危优先截流（不算次数）
  if (isCritical(text)) {
    return `今は動き方を間違えやすい状態です。

👇 送るなら
「少し時間置いた方がいいかもね」

ここからの動き方で結果が大きく変わります。

👉 Pro（月額¥980）で詳しく見れます`;
  }

  // 🟡 免费次数用完（第4次）
  if (user.count >= 3) {
    return `無料での返信はここまでです。

ここからは、状況に合わせた進め方が必要になります。

👇 送るなら
「無理しないでね」

👉 Pro（月額¥980）で詳しい進め方が見れます`;
  }

  // 🟢 正常免费回复
  const scenario = detectScenario(text);

  const ai = await generateAIResponse({
    input: text,
    userState: { scenario }
  });

  const result = buildFreeReply(ai);

  user.count += 1;

  return result;
}

module.exports = { handleMessage };
