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

function isStopContact(text = "") {
  return /もういい|疲れた|連絡しないで|しばらく連絡しないで|距離置きたい|一人にして|今は無理/.test(
    String(text)
  );
}

function isCritical(text = "") {
  return /復縁|戻りたい|やり直したい|別れ|別れたい|もう無理|浮気|怪しい|距離置きたい|連絡しないで|しばらく連絡しないで/.test(
    String(text)
  );
}

function detectInputType(text = "", context = {}) {
  const t = String(text).trim();

  if (!t) return "unknown";

  if (/「.+」/.test(t)) return "partner";

  if (
    /^(ごめん|忙しい|今忙しい|また連絡する|了解|うん|そうだね|大丈夫|ありがとう|ごめんね|もういい|疲れた|今は無理|しばらく連絡しないで)/.test(t)
  ) {
    return "partner";
  }

  if (/復縁したい|戻りたい|やり直したい|どうすれば戻れる|どうしたら戻れる/.test(t)) {
    return "intent";
  }

  if (/したい|どうすれば|どうしたら|送っていい|返せばいい|誘いたい|告白したい/.test(t)) {
    return "intent";
  }

  if (/最近|なんか|気がする|感じる|されてる|かも|距離|冷たい|そっけない|返信|返事|既読|未読|怪しい/.test(t)) {
    return "situation";
  }

  if (
    context.lastInput &&
    /返事|返信|来なかった|次|どうする|どうしたら|待つ|送る|いつ|その後|もし/.test(t)
  ) {
    return "followup";
  }

  if (t.length <= 25) return "unknown";

  return "situation";
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
    return `今は、復縁したい気持ちをそのまま出すほど、相手が身構えやすい状態です。

👇 送るなら
「今すぐ戻りたいわけじゃないけど、少しだけ話せたら嬉しい」

⚠️ ここだけ注意
ここで気持ちを強く出すと、
相手が警戒しやすくなります。

ここから先は、
送る内容よりも「順番」と「タイミング」で結果が変わる部分です。

Pro（月額¥980）で続きを確認できます。`;
  }

  if (isStopContact(input)) {
    return `今は、これ以上やり取りしたくない状態です。

👇 送るなら
「わかった。今はこれ以上送らないね」

⚠️ ここだけ注意
ここで理由を聞いたり、謝りすぎたりすると、
“まだ追ってくる”と思われやすいです。

ここから先は、
いつ送るか、どこまで待つかで流れが変わる部分です。

Pro（月額¥980）で続きを確認できます。`;
  }

  if (scenario === "cheating") {
    return `今は、問い詰めるほど相手の本音が見えにくくなる状態です。

👇 送るなら
「最近ちょっと様子違う気がして。何かあった？」

⚠️ ここだけ注意
ここで疑いをそのままぶつけると、
相手が防御に入りやすくなります。

ここから先は、
聞き方や次の反応の見方で判断が分かれる部分です。

Pro（月額¥980）で続きを確認できます。`;
  }

  return `今は、動き方を間違えると関係が崩れやすい状態です。

👇 送るなら
「少し落ち着いたら、また話せたら嬉しい」

⚠️ ここだけ注意
ここで踏み込みすぎると、
一気に距離が広がる可能性があります。

Pro（月額¥980）で続きを確認できます。`;
}

function buildLimitReply() {
  return `無料版ではここまで表示しています。

ここから先は、
やりがちな判断ミスや、
送るタイミング・選択肢によって
流れが崩れやすい部分です。

Pro（月額¥980）で続きを確認できます。`;
}

async function generateFree(input, user, forcedType = null) {
  if (user.count >= FREE_LIMIT) {
    return buildLimitReply();
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

    if (input === "1" || input.includes("相手")) {
      return generateFree(original, user, "partner");
    }

    if (input === "2" || input.includes("状況")) {
      return generateFree(original, user, "situation");
    }

    user.pendingClarify = true;
    user.pendingText = original;

    return `①か②で教えてください。

① 相手から来たLINE
② 今の状況説明`;
  }

  const inputType = detectInputType(input, user.context);
  const scenario = detectScenario(input);

  if (user.plan === "pro") {
    updateContext(user, input, inputType, scenario);
    return generateProResponse(input, scenario);
  }

  if (isCritical(input)) {
    updateContext(user, input, inputType, scenario);
    return buildCriticalReply(input, inputType, scenario);
  }

  if (inputType === "unknown") {
    user.pendingClarify = true;
    user.pendingText = input;
    return buildClarifyReply();
  }

  return generateFree(input, user, inputType);
}

module.exports = { handleMessage };
