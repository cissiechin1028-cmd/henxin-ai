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
const PRO_URL = process.env.PRO_URL || "";

function isGreeting(text = "") {
  const t = String(text).trim().toLowerCase();

  return /^(おはよう|おはようございます|こんにちは|こんばんは|お疲れ様|お疲れ様です|はじめまして|よろしく|よろしくお願いします|hello|hi|早安|你好|晚上好)$/i.test(t);
}

function detectGreetingReplyWord(text = "") {
  const t = String(text).trim();

  if (/おはよう|早安/.test(t)) return "おはようございます";
  if (/こんばんは|晚上好/.test(t)) return "こんばんは";
  if (/お疲れ/.test(t)) return "お疲れ様です";
  if (/よろしく/.test(t)) return "よろしくお願いします";
  if (/你好|こんにちは|hello|hi|はじめまして/i.test(t)) return "こんにちは";

  return "こんにちは";
}

function buildGreetingReply(text = "") {
  const greeting = detectGreetingReplyWord(text);

  return `${greeting}😊

相手から来たLINEや、
今の状況をそのまま送ってください。

そのまま使える返信を作ります。`;
}

function detectInputType(text = "", user = {}) {
  const t = String(text).trim();

  if (!t) return "unknown";

  if (/「.+」/.test(t)) return "partner";

  if (/相手から|相手のメッセージ|相手に言われた|彼から|彼女から/.test(t)) {
    return "situation";
  }

  if (/どう返せば|なんて返せば|返信したい|返事したい|どう思う|相談|どうしよ|不安/.test(t)) {
    return "situation";
  }

  if (/復縁したい|戻りたい|告白したい|誘いたい|会いたい/.test(t)) {
    return "situation";
  }

  if (/返信|既読|未読|無視|冷たい|距離|別れ|復縁|浮気|怪しい|喧嘩|ブロック|好き|告白|誘い|デート|連絡|LINE|脈あり|脈なし/.test(t)) {
    return "situation";
  }

  if (user.lastInput && /^(続き|つづき|次|どうする|返事)$/i.test(t)) {
    return "followup";
  }

  if (t.length <= 2) return "unknown";

  if (t.length <= 20) return "partner";

  return "situation";
}

function isHighIntentInput(text = "") {
  const t = String(text).trim();

  return /復縁|戻りたい|浮気|怪しい|別れ|別れそう|ブロック|既読無視|未読無視|脈なし|冷たい|距離|喧嘩|嫌われた|終わり/.test(t);
}

function buildClarifyReply() {
  return `これ、どっちですか？

① 相手から来たLINE
② 今の状況`;
}

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

function buildHardPaywallReply() {
  if (PRO_URL) {
    return `無料で見られる回数はここまでです。

この先では、

・相手の温度感
・次にどう動くか
・送るタイミング
・そのまま使える返信

まで確認できます。

続きを見る👇
${PRO_URL}`;
  }

  return `無料で見られる回数はここまでです。

この先では、

・相手の温度感
・次にどう動くか
・送るタイミング
・そのまま使える返信

まで確認できます。

続きを見る`;
}

function buildOpenGuide() {
  if (PRO_URL) {
    return `開通はこちら👇
${PRO_URL}

開通後、もう一度メッセージを送ってください。`;
  }

  return `開通リンクは準備中です。`;
}

function attachContinueHint(text, count, isHighIntent = false) {
  if (count === 1) {
    if (isHighIntent) {
      return `${text}

※この状況は、次の一言を間違えると相手の温度が下がりやすいです。
相手の返事や、今の状況をもう少し送ってください。`;
    }

    return `${text}

相手の返事が来たら、そのまま送ってください。
次にどう返すのが自然か、一緒に見ます。`;
  }

  if (count === 2) {
    if (isHighIntent) {
      return `${text}

※ここからは、勢いで送るより「送る順番」がかなり大事です。
次の状況を送ってくれたら、危ない返し方を避けて考えます。`;
    }

    return `${text}

この流れなら、次にどう動くかも見れます。
相手の返信や迷っている内容を、そのまま送ってください。`;
  }

  if (count === 3) {
    if (PRO_URL) {
      if (isHighIntent) {
        return `${text}

無料で見られるのはここまでです。

この状況は、返信内容だけでなく
「いつ送るか」「どこまで踏み込むか」で結果が変わりやすいです。

この先では、

・今送るべきか
・何時間空けるべきか
・送るならどの一言が安全か
・送らない方がいいNG返信

まで確認できます。

続きを見る👇
${PRO_URL}`;
      }

      return `${text}

無料で見られるのはここまでです。

ここから先は、
送る内容だけでなく「送るタイミング」も大事です。

この先では、

・今送るべきか
・何時間空けるべきか
・送るならどの一言が自然か

まで確認できます。

続きを見る👇
${PRO_URL}`;
    }

    return `${text}

無料で見られるのはここまでです。

ここから先は、
送る内容だけでなく「送るタイミング」も大事です。

続きを見る`;
  }

  return text;
}

async function generateFree(userId, input, forcedType = null) {
  const user = getUser(userId);

  let inputType = forcedType || detectInputType(input, user);

  if (inputType === "followup") {
    inputType = user.lastInputType || "situation";
    input = user.lastInput || input;
  }

  const scenario = detectScenario(input);
  const isHighIntent = isHighIntentInput(input);

  const ai = await generateAIResponse({
    input,
    userState: {
      inputType,
      scenario,
      context: {
        lastInput: user.lastInput,
        lastInputType: user.lastInputType,
        lastScenario: user.lastScenario,
        lastAdvice: user.lastAdvice,
        lastRiskLevel: user.lastRiskLevel
      }
    }
  });

  const updatedUser = incrementReplyUsage(userId);
  const nextCount = updatedUser.usageCount;

  updateUser(userId, {
    lastInput: input,
    lastInputType: inputType,
    lastScenario: scenario,
    lastAdvice: ai
  });

  return attachContinueHint(ai, nextCount, isHighIntent);
}

async function handleMessage(userId, text) {
  const input = String(text || "").trim();

  if (!input) {
    return buildClarifyReply();
  }

  if (input === "__reset__") {
    resetUser(userId);
    return "リセットしました";
  }

  const user = getUser(userId);

  if (isGreeting(input)) {
    return buildGreetingReply(input);
  }

  if (/^(開通|購入|支払い|続きを見る)$/i.test(input)) {
    return buildOpenGuide();
  }

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

  if (user.usageCount >= FREE_LIMIT) {
    updateUser(userId, {
      paywall: true
    });

    return buildHardPaywallReply();
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
