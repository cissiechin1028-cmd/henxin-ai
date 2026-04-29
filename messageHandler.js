const { generateAIResponse } = require("./services/ai");
const { generateProResponse } = require("./services/proEngine");

let users = {};

// =====================
// 判定函数
// =====================

function isGreeting(text = "") {
  return /^(こんにちは|こんばんは|おはよう|おはようございます|お疲れ様|お疲れ様です|はじめまして|hi|hello)$/i.test(
    String(text).trim()
  );
}

function isCritical(text = "") {
  return /復縁|別れ|別れたい|もう無理|浮気|怪しい|距離置きたい|連絡しないで|しばらく連絡しないで/.test(
    String(text)
  );
}

function isClearlySituation(text = "") {
  return /最近|なんか|気がする|されてる|どうすれば|どうしたら|脈あり|脈なし|返信こない|返事こない|既読無視|未読無視|冷たい|距離感じる/.test(
    String(text)
  );
}

function isClearlyPartnerMessage(text = "") {
  const t = String(text).trim();

  if (/「.+」/.test(t)) return true;

  if (
    /^(ごめん|忙しい|今忙しい|また連絡する|了解|うん|そうだね|大丈夫|ありがとう|ごめんね)/.test(t)
  ) {
    return true;
  }

  if (
    /疲れた|もういい|今は一人にして|考えさせて|しばらく連絡しないで|距離置きたい/.test(t)
  ) {
    return true;
  }

  return false;
}

function isAmbiguous(text = "") {
  const t = String(text).trim();

  if (!t) return false;
  if (isGreeting(t)) return false;
  if (isCritical(t)) return false;
  if (isClearlyPartnerMessage(t)) return false;
  if (isClearlySituation(t)) return false;

  return t.length <= 25;
}

function detectScenario(text = "") {
  if (/浮気|怪しい/.test(text)) return "cheating";
  if (/復縁|別れ|別れたい|戻りたい|やり直したい/.test(text)) return "reunion";
  if (/既読|未読|返信こない|返事こない/.test(text)) return "ignore";
  if (/好き|告白|誘いたい|デート/.test(text)) return "flirt";
  if (/冷たい|距離|そっけない/.test(text)) return "cold";
  return "normal";
}

// =====================
// 输出模板
// =====================

function buildGreetingReply(input = "") {
  const t = String(input).trim();

  let greeting = "こんにちは😊";

  if (/こんばんは/.test(t)) greeting = "こんばんは😊";
  if (/おはよう/.test(t)) greeting = "おはようございます😊";
  if (/お疲れ様/.test(t)) greeting = "お疲れ様です😊";
  if (/はじめまして/.test(t)) greeting = "はじめまして😊";

  return `${greeting}

相手から来たLINEや、
今の状況をそのまま送ってください。

そのまま使える返信を作ります。`;
}

function buildClarifyReply() {
  return `これはどちらですか？

① 相手から来たLINE
② 今の状況説明

そのまま番号で教えてください。`;
}

function buildFreeReply(aiText) {
  const lines = String(aiText || "").split("\n").filter(Boolean);
  const reply =
    lines.find((l) => l.includes("「")) ||
    "「最近どう？無理してない？」";

  return `今は、少し様子を見るのが自然です。

👇 送るなら
${reply}

⚠️ ここだけ注意
重くなると距離が広がりやすいです。`;
}

function buildCriticalPaywall() {
  return `今は動き方を間違えやすい状態です。

👇 送るなら
「少し時間置いた方がいいかもね」

ここからの動き方で結果が大きく変わります。

👉 Pro（月額¥980）で詳しく見れます`;
}

function buildFreeLimitPaywall() {
  return `無料での返信はここまでです。

ここからは、状況に合わせた進め方が必要になります。

👇 送るなら
「無理しないでね」

👉 Pro（月額¥980）で詳しい進め方が見れます`;
}

// =====================
// 主流程
// =====================

async function generateFreeResult(input, user) {
  if (user.count >= 3) {
    return buildFreeLimitPaywall();
  }

  const scenario = detectScenario(input);

  const ai = await generateAIResponse({
    input,
    userState: { scenario }
  });

  user.count += 1;

  return buildFreeReply(ai);
}

async function handleMessage(userId, text) {
  const input = String(text || "").trim();

  if (!users[userId]) {
    users[userId] = {
      count: 0,
      plan: "free",
      pendingClarify: false,
      pendingText: null
    };
  }

  const user = users[userId];

  // ① 打招呼
  if (isGreeting(input)) {
    return buildGreetingReply(input);
  }

  // ② 反问确认流程
  if (user.pendingClarify) {
    const originalText = user.pendingText;

    user.pendingClarify = false;
    user.pendingText = null;

    if (input === "1" || input.includes("相手")) {
      return generateFreeResult(originalText, user);
    }

    if (input === "2" || input.includes("状況")) {
      return generateFreeResult(originalText, user);
    }

    user.pendingClarify = true;
    user.pendingText = originalText;

    return `①か②で教えてください。

① 相手から来たLINE
② 今の状況説明`;
  }

  // ③ Pro用户
  if (user.plan === "pro") {
    const scenario = detectScenario(input);
    return generateProResponse(input, scenario);
  }

  // ④ 高危
  if (isCritical(input)) {
    return buildCriticalPaywall();
  }

  // ⑤ 不明确 → 反问
  if (isAmbiguous(input)) {
    user.pendingClarify = true;
    user.pendingText = input;
    return buildClarifyReply();
  }

  // ⑥ 正常免费
  return generateFreeResult(input, user);
}

module.exports = { handleMessage };
