const { generateAIResponse } = require("./services/ai");
const { generateProResponse } = require("./services/proEngine");

let users = {};

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
  return /最近|なんか|気がする|感じる|距離|冷たい|そっけない|返信こない|返事こない|既読無視|未読無視|どうすれば|どうしたら/.test(
    String(text)
  );
}

function isClearlyPartnerMessage(text = "") {
  const t = String(text).trim();

  if (/「.+」/.test(t)) return true;

  if (/^(ごめん|忙しい|今忙しい|また連絡する|了解|うん|そうだね|大丈夫|ありがとう|ごめんね)/.test(t)) {
    return true;
  }

  if (/疲れた|もういい|今は一人にして|考えさせて|しばらく連絡しないで|距離置きたい/.test(t)) {
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

番号で教えてください。`;
}

function buildCriticalReply() {
  return `今は、動き方を間違えると距離が固定されやすい状態です。

👇 送るなら
「少し落ち着いたら、また話せたら嬉しい」

⚠️ ここだけ注意
ここで気持ちを強く出すと、
相手が一気に身構える可能性があります。

ここから先は、
やりがちな判断ミスや、
送るタイミング・選択肢によって
流れが崩れやすい部分です。

Pro（月額¥980）で続きを確認できます。`;
}

function buildLimitReply(aiText) {
  return `${aiText}

無料版ではここまで表示しています。

ここから先は、
やりがちな判断ミスや、
送るタイミング・選択肢によって
流れが崩れやすい部分です。

Pro（月額¥980）で続きを確認できます。`;
}

async function generateFree(input, user) {
  const scenario = detectScenario(input);

  const ai = await generateAIResponse({
    input,
    userState: { scenario }
  });

  user.count += 1;

  if (user.count >= 3) {
    return buildLimitReply(ai);
  }

  return ai;
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

  if (isGreeting(input)) {
    return buildGreetingReply(input);
  }

  if (user.pendingClarify) {
    const original = user.pendingText;

    user.pendingClarify = false;
    user.pendingText = null;

    if (input === "1" || input.includes("相手")) {
      return generateFree(original, user);
    }

    if (input === "2" || input.includes("状況")) {
      return generateFree(original, user);
    }

    user.pendingClarify = true;
    user.pendingText = original;

    return `①か②で教えてください。

① 相手から来たLINE
② 今の状況説明`;
  }

  if (user.plan === "pro") {
    const scenario = detectScenario(input);
    return generateProResponse(input, scenario);
  }

  if (isCritical(input)) {
    return buildCriticalReply();
  }

  if (isAmbiguous(input)) {
    user.pendingClarify = true;
    user.pendingText = input;
    return buildClarifyReply();
  }

  return generateFree(input, user);
}

module.exports = { handleMessage };
