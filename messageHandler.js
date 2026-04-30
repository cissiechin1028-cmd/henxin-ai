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
      lastPartnerMessage: null,
      lastSituation: null,
      userGoal: null,
      lastAdvice: null
    }
  };
}

function isGreeting(text = "") {
  return /^(こんにちは|こんばんは|おはよう|おはようございます|お疲れ様|お疲れ様です|はじめまして|hi|hello)$/i.test(
    String(text).trim()
  );
}

function detectScenario(text = "") {
  const t = String(text);

  if (/浮気|怪しい|他に誰か|隠して|嘘/.test(t)) return "cheating";
  if (/復縁|戻りたい|やり直したい/.test(t)) return "reunion";
  if (/別れ|別れたい|もう無理|冷めた/.test(t)) return "breakup";
  if (/既読|未読|返信こない|返事こない|無視/.test(t)) return "ignore";
  if (/好き|告白|誘いたい|デート/.test(t)) return "flirt";
  if (/冷たい|距離|そっけない|テンション低い/.test(t)) return "cold";

  return "normal";
}

function isCritical(text = "") {
  return /復縁|戻りたい|やり直したい|別れ|別れたい|もう無理|浮気|怪しい|距離置きたい|連絡しないで|しばらく連絡しないで/.test(
    String(text)
  );
}

function detectInputType(text = "", context = {}) {
  const t = String(text).trim();

  if (/「.+」/.test(t)) return "partner";

  if (
    /^(ごめん|もういい|疲れた|今は無理|しばらく連絡しないで)/.test(t)
  ) {
    return "partner";
  }

  if (/したい|どうすれば|復縁|戻りたい/.test(t)) {
    return "intent";
  }

  if (/最近|なんか|気がする|感じる|距離|冷たい|返信|怪しい/.test(t)) {
    return "situation";
  }

  if (
    context.lastInput &&
    /返事|返信|次|どうする|どうしたら|待つ|送る|いつ/.test(t)
  ) {
    return "followup";
  }

  return "unknown";
}

function updateContext(user, input, inputType, scenario, advice = null) {
  user.context.lastInput = input;
  user.context.lastInputType = inputType;
  user.context.lastScenario = scenario;

  if (inputType === "partner") {
    user.context.lastPartnerMessage = input;
  }

  if (inputType === "situation") {
    user.context.lastSituation = input;
  }

  if (inputType === "intent") {
    user.context.userGoal = input;
  }

  if (advice) {
    user.context.lastAdvice = advice;
  }
}

/** ✅ 改动1：打招呼恢复（こんにちは→こんにちは、こんばんは→こんばんは 等） */
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

function buildCriticalReply(input, inputType, scenario) {
  if (inputType === "intent" || scenario === "reunion") {
    return `今は、気持ちをそのまま出すほど相手が身構えやすい状態です。

👇 送るなら
「今すぐ戻りたいわけじゃないけど、少しだけ話せたら嬉しい」

⚠️ ここだけ注意
ここで想いを強く出すと、
相手が本音を隠したまま距離を取る流れに入りやすくなります。

ここから先は、
やりがちな判断ミスや、
送る順番・タイミング・他の選択肢を一つでも間違えると、
関係が戻らない方向に固定されやすい段階です。

Pro（月額¥980）で詳しく見れます。`;
  }

  if (scenario === "cheating") {
    return `今は、問い詰めるほど本音が見えにくくなる状態です。

👇 送るなら
「最近ちょっと様子違う気がして。何かあった？」

⚠️ ここだけ注意
ここで疑いをそのままぶつけると、
相手が防御に入り、本音を隠したまま距離を取る流れに入りやすくなります。

ここから先は、
やりがちな聞き方のミスや、
反応の見方・次の一手を間違えると、
見極められないまま関係が崩れる可能性がある段階です。

Pro（月額¥980）で詳しく見れます。`;
  }

  return `今は、動き方を間違えると関係が崩れやすい状態です。

👇 送るなら
「少し落ち着いたら、また話せたら嬉しい」

⚠️ ここだけ注意
ここで踏み込みすぎると、
一気に距離が広がる可能性があります。

ここから先は、
やりがちな判断ミスや、
タイミング・選択肢を間違えると
流れが崩れやすい段階です。

Pro（月額¥980）で詳しく見れます。`;
}

function buildLimitReply(aiText) {
  return `${aiText}

ここから先は、
やりがちな判断ミスや、
送るタイミング・他の選択肢を一つでも間違えると、
相手が本音を隠したまま距離を取る流れに入りやすい段階です。

Pro（月額¥980）で詳しく見れます。`;
}

async function generateFree(input, user, forcedType = null) {
  if (user.count >= FREE_LIMIT) {
    return buildLimitReply("今は、無理に踏み込まず様子を見るのが安全です。");
  }

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

  user.count += 1;
  updateContext(user, input, inputType, scenario, ai);

  return ai;
}

async function handleMessage(userId, text) {
  const input = String(text || "").trim();

  if (!users[userId]) {
    users[userId] = createUser();
  }

  const user = users[userId];

  if (isGreeting(input)) {
    return buildGreetingReply(input);
  }

  if (user.pendingClarify) {
    const original = user.pendingText;

    user.pendingClarify = false;
    user.pendingText = null;

    if (input === "1") return generateFree(original, user, "partner");
    if (input === "2") return generateFree(original, user, "situation");

    user.pendingClarify = true;
    user.pendingText = original;
    return "①か②で教えてください。";
  }

  const inputType = detectInputType(input, user.context);
  const scenario = detectScenario(input);

  if (user.plan === "pro") {
    return generateProResponse(input, scenario);
  }

  /** ✅ 改动2：高危也走免费（不直接拦） */
  if (isCritical(input)) {
    return generateFree(input, user, inputType);
  }

  if (inputType === "unknown") {
    user.pendingClarify = true;
    user.pendingText = input;
    return buildClarifyReply();
  }

  return generateFree(input, user, inputType);
}

module.exports = { handleMessage };
