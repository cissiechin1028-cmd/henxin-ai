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

function isGreeting(text = "") {
  const t = String(text).trim().toLowerCase();
  return /^(おはよう|こんにちは|こんばんは|お疲れ|はじめまして|hello|hi|早安|你好|晚上好)/.test(t);
}

function buildGreetingReply(input = "") {
  const t = String(input).trim();

  let greeting = "";

  if (/おはよう|早安|morning/i.test(t)) {
    greeting = "おはようございます😊";
  } else if (/こんばんは|evening|晚上好/i.test(t)) {
    greeting = "こんばんは😊";
  } else if (/お疲れ|辛苦/i.test(t)) {
    greeting = "お疲れ様です😊";
  } else if (/はじめまして|nice/i.test(t)) {
    greeting = "はじめまして😊";
  } else {
    greeting = "こんにちは😊";
  }

  return `${greeting}

相手から来たLINEや、
今の状況をそのまま送ってください。

そのまま使える返信を作ります。`;
}

function isContinueRequest(text = "") {
  const t = String(text).trim();
  return /^(続き|つづき)$/.test(t);
}

function detectScenario(text = "") {
  const t = String(text).trim();

  if (
    /浮気|不倫|怪しい|怪し|他に.*いる|誰かいる|ほかに.*いる|他の人|別の人|女いる|男いる|元カノ|元彼|隠して|隠す|スマホ隠す|スマホ見せない|通知隠す|急に優しい|急に冷たい|嘘ついてる|嘘っぽい|裏切り|信用できない/.test(t)
  ) {
    return "cheating";
  }

  if (
    /別れ|別れたい|別れよう|もう無理|終わり|冷めた|好きじゃない|距離置きたい|距離を置きたい|しばらく連絡しないで|連絡しないで|一人になりたい|疲れた|もういい/.test(t)
  ) {
    return "breakup";
  }

  if (
    /復縁|戻りたい|やり直したい|もう一度|元カレ|元彼|元カノ|忘れられない/.test(t)
  ) {
    return "reunion";
  }

  if (
    /返信こない|返事こない|返信来ない|返事来ない|既読無視|未読無視|無視され|既読ついた|既読ついてる|未読のまま|連絡こない|連絡来ない|返ってこない|返って来ない/.test(t)
  ) {
    return "ignore";
  }

  if (
    /冷たい|そっけない|素っ気ない|距離|距離感じる|距離を感じる|温度差|前と違う|最近変|なんか変|態度変わった|連絡減った|会ってくれない|避けられてる|脈なし|優先度下がった/.test(t)
  ) {
    return "cold";
  }

  if (
    /告白|好きって言いたい|好きかも|誘いたい|デート誘いたい|会いたい|会おうって言いたい|ご飯誘いたい|飲みに誘いたい|脈あり|脈ある|いい感じ|距離縮めたい|もっと仲良くなりたい/.test(t)
  ) {
    return "flirt";
  }

  return "normal";
}

function detectInputType(text = "", context = {}) {
  const t = String(text).trim();

  if (!t) return "unknown";

  if (/「.+」/.test(t)) return "partner";

  if (
    context.lastInput &&
    /返事|どう返す|なんて返す|どうする|次|どうしよ|どうすればいい|どうしたらいい|これでいい|これで大丈夫|このままでいい|これ送っていい|送っていい|送って大丈夫|送るのはいい|送るのあり|送ってもいい|大丈夫かな|いいの|他にある|別の言い方|もっと自然|もう少し|短くして|やわらかく|強めに|軽く|直して|変えて|これどう|どう思う/.test(t)
  ) {
    return "followup";
  }

  if (
    /^(ごめん|もういい|疲れた|今は無理|連絡しないで|別れたい|距離置きたい|しばらく連絡しないで)/.test(t)
  ) {
    return "partner";
  }

  if (
    /復縁したい|戻りたい|告白したい|誘いたい|会いたい|仲良くなりたい|距離縮めたい/.test(t)
  ) {
    return "intent";
  }

  if (
    /どうしよ|微妙|無理|疲れた|不安|最近|なんか|気がする|感じる|距離|冷たい|怪しい|浮気|誰かいる|他にいる|返信こない|既読無視|未読無視/.test(t)
  ) {
    return "situation";
  }

  if (context.lastInput && t.length <= 12) {
    return "followup";
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

function buildLimitReply() {
  return `無料版で使える3回分はここまでです。

この先の詳しい判断や、
相手の本音・次の動き方はProで確認できます。

Pro（月額¥980）で続きを見る`;
}

function buildSoftLimitReply(input = "") {
  if (/どうすればいい|どうしたらいい|どうする|次/.test(input)) {
    return `今は、無理に踏み込まず少し距離を保つのが安全です。

焦って動くと関係が悪化しやすいので、
まずは相手の反応を見ながら、余白を残すのが大切です。

この先の具体的な動き方や、
相手の本音はProで確認できます。

Pro（月額¥980）で続きを見る`;
  }

  return buildLimitReply();
}

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

相手の本音やこの先の流れまで含めると、
「続き」と送るともう少し精度が上がります。`;
  }

  return text;
}

async function generateFree(input, user, forcedType = null) {
  if (user.count >= FREE_LIMIT) {
    return buildSoftLimitReply(input);
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

  user.count++;
  updateContext(user, input, inputType, scenario, ai);

  return attachContinueHint(ai, user.count);
}

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

  if (isContinueRequest(input)) {
    if (!user.context.lastAdvice) {
      return `先に、相手から来たLINEか今の状況を送ってください。

その後に「続き」と送ると、さらに詳しく見れます。`;
    }

    return generateAIResponse({
      input,
      userState: {
        inputType: "followup",
        scenario: user.context.lastScenario || "normal",
        context: user.context
      }
    });
  }

  if (isGreeting(input)) {
    return buildGreetingReply(input);
  }

  if (user.plan === "pro") {
    return generateProResponse(input);
  }

  if (user.count >= FREE_LIMIT) {
    return buildSoftLimitReply(input);
  }

  if (user.pendingClarify) {
    const original = user.pendingText;
    user.pendingClarify = false;

    if (/^(1|①|a)$/i.test(input)) {
      return generateFree(original, user, "partner");
    }

    if (/^(2|②|b)$/i.test(input)) {
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
