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

/* 打招呼识别 */
function isGreeting(text = "") {
  const t = String(text).trim().toLowerCase();
  return /^(おはよう|こんにちは|こんばんは|お疲れ|はじめまして|hello|hi|早安|你好|晚上好)/.test(t);
}

/* 打招呼回复 */
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

/* 続き识别 */
function isContinueRequest(text = "") {
  const t = String(text).trim();
  return /^(続き|つづき)$/.test(t);
}

/* 场景识别 */
function detectScenario(text = "") {
  const t = String(text);

  if (/浮気|怪しい/.test(t)) return "cheating";
  if (/復縁|戻りたい/.test(t)) return "reunion";
  if (/別れ|もう無理/.test(t)) return "breakup";
  if (/返信こない|無視/.test(t)) return "ignore";
  if (/告白|誘いたい/.test(t)) return "flirt";
  if (/冷たい|距離/.test(t)) return "cold";

  return "normal";
}

/* 输入类型识别（稳定版） */
function detectInputType(text = "", context = {}) {
  const t = String(text).trim();

  if (!t) return "unknown";

  if (/「.+」/.test(t)) return "partner";

  if (/^(ごめん|もういい|疲れた|今は無理|連絡しないで|別れたい)/.test(t)) {
    return "partner";
  }

  if (/復縁したい|戻りたい|告白したい|誘いたい/.test(t)) {
    return "intent";
  }

  if (
    context.lastInput &&
    /返事|どうする|次|どうしよ/.test(t)
  ) {
    return "followup";
  }

  /* 情绪词 */
  if (/どうしよ|微妙|無理|疲れた|不安/.test(t)) {
    return "situation";
  }

  /* 正常状况：必须放在短句 unknown 前面 */
  if (/最近|なんか|気がする|感じる|距離|冷たい|怪しい/.test(t)) {
    return "situation";
  }

  /* 短句默认 unknown（避免乱判） */
  if (t.length <= 10) return "unknown";

  return "unknown";
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

今の情報でもある程度は見れていますが、

相手の本音やこの先の流れまで含めると、
「続き」と送るともう少し精度が上がります。`;
  }

  return text;
}

/* AI生成 */
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

  user.count++;
  updateContext(user, input, inputType, scenario, ai);

  return attachContinueHint(ai, user.count);
}

/* 主逻辑 */
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

  // 「続き」は最優先で処理。①②確認より先。
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
    return buildLimitReply();
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
