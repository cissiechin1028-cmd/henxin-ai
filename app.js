const { generateAIResponse } = require("./services/ai");
const { generateProResponse } = require("./services/proEngine");

let users = {};

function detectScenario(text) {
  if (/浮気|怪しい/.test(text)) return "cheating";
  if (/復縁|別れ/.test(text)) return "reunion";
  if (/既読/.test(text)) return "ignore";
  if (/好き|告白|誘いたい/.test(text)) return "flirt";
  if (/冷たい|距離/.test(text)) return "cold";
  return "normal";
}

function detectLevel(scenario) {
  if (["reunion", "cheating", "ignore"].includes(scenario)) return 3;
  if (["cold", "flirt"].includes(scenario)) return 2;
  return 1;
}

function getVariation(level) {
  if (level === 1) return "軽く返すのが自然です。";
  if (level === 2) return "あえて深く触れない方が安全です。";
  return "今は動き方を間違えやすいタイミングです。";
}

function buildReply(aiText, count, level, scenario) {
  const lines = aiText.split("\n").filter(Boolean);
  let reply = lines.find(l => l.includes("「")) || "「無理しないでね😊」";

  const judge = getVariation(level);

  if (count === 0) {
    return `${judge}

👇 送るなら
${reply}`;
  }

  if (count === 1) {
    return `${judge}

強く出すと、相手に負担になる可能性があります。

👇 送るなら
${reply}

⚠️ ここだけ注意
優しすぎると後回しにされることがあります。`;
  }

  if (count === 2) {
    const isPro = level === 3;

    return `${judge}

強く出すと、関係の温度が下がることがあります。

👇 送るなら
${reply}

⚠️ ここだけ注意
ここでの返し方で、
関係が続くか距離が広がるか分かれやすいです。

${isPro ? "詳しく見るならProで確認できます。" : "自然な言い方はプレミアムで確認できます。"}`;
  }

  return aiText;
}

async function handleMessage(userId, text) {
  if (!users[userId]) users[userId] = { count: 0, plan: "free" };

  const user = users[userId];

  const scenario = detectScenario(text);
  const level = detectLevel(scenario);

  if (user.plan === "pro") {
    return generateProResponse(text, scenario);
  }

  if (user.count >= 3) {
    return level === 3
      ? "ここからは動き方が重要です。Proで確認できます。"
      : "ここからは言い方が重要です。プレミアムで確認できます。";
  }

  const ai = await generateAIResponse({ input: text, userState: { scenario } });

  const result = buildReply(ai, user.count, level, scenario);

  user.count += 1;

  return result;
}

module.exports = { handleMessage };
