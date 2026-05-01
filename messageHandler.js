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
  return /^(こんにちは|こんばんは|おはよう|お疲れ様|お疲れ様です|はじめまして)$/i.test(
    String(text).trim()
  );
}

/* 🔥 场景识别（不动） */
function detectScenario(text = "") {
  const t = String(text).trim();

  if (/浮気|怪しい|他に誰か|嘘/.test(t)) return "cheating";
  if (/復縁|戻りたい|やり直したい/.test(t)) return "reunion";
  if (/別れ|別れたい|もう無理/.test(t)) return "breakup";
  if (/既読|未読|返信こない|無視/.test(t)) return "ignore";
  if (/告白|好き|誘いたい/.test(t)) return "flirt";
  if (/冷たい|距離|テンション低い/.test(t)) return "cold";

  return "normal";
}

/* 🔥 输入类型识别（这里只做“最小修复”） */
function detectInputType(text = "", context = {}) {
  const t = String(text).trim();

  if (!t) return "unknown";

  /* 对方原话 */
  if (/「.+」/.test(t)) return "partner";
  if (/^(ごめん|もういい|疲れた|今は無理|連絡しないで|距離置きたい|別れたい)/.test(t)) {
    return "partner";
  }

  /* 意图 */
  if (/復縁したい|戻りたい|やり直したい|告白したい|誘いたい/.test(t)) {
    return "intent";
  }

  /* 跟进 */
  if (
    context.lastInput &&
    /返事|どうする|どうしたら|次|どうしよ/.test(t)
  ) {
    return "followup";
  }

  /* 🔥 关键修复（只改这里） */
  if (/どうしよ|どうしよう|微妙|無理|疲れた|不安/.test(t)) {
    return "situation";
  }

  /* ❌ 不再把短句直接当 situation */
  if (t.length <= 10) return "unknown";

  /* 正常状况 */
  if (
    /最近|なんか|気がする|感じる|距離|冷たい|返信|不安|怪しい/.test(t)
  ) {
    return "situation";
  }

  return "unknown";
}

function updateContext(user, input, type, scenario, advice = null) {
  user.context.lastInput = input;
  user.context.lastInputType = type;
  user.context.lastScenario = scenario;

  if (type === "partner") user.context.lastPartnerMessage = input;
  if (type === "situation") user.context.lastSituation = input;
  if (type === "intent") user.context.userGoal = input;
  if (advice) user.context.lastAdvice = advice;
}

function buildGreetingReply(input = "") {
  const t = input.trim();

  let g = "こんにちは😊";
  if (/こんばんは/.test(t)) g = "こんばんは😊";

  return `${g}

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

function buildLimitReply(text) {
  return `${text}

無料版ではここまで表示しています。

ここから先は、
やりがちな判断ミスや、
送るタイミング・他の選択肢を一つでも間違えると、
相手が本音を隠したまま距離を取る流れに入りやすい段階です。

Pro（月額¥980）で詳しく見れます。`;
}

/* 🔥 free生成（单 return，不叠加） */
async function generateFree(input, user, forcedType = null) {
  if (user.count >= FREE_LIMIT) {
    return buildLimitReply(
      user.context.lastAdvice || "今は慎重に動くべき段階です。"
    );
  }

  const type = forcedType || detectInputType(input, user.context);
  const scenario = detectScenario(input);

  const ai = await generateAIResponse({
    input,
    userState: {
      inputType: type,
      scenario,
      context: user.context
    }
  });

  user.count++;
  updateContext(user, input, type, scenario, ai);

  return ai;
}

/* 🔥 主逻辑（不会重复问 / 不叠加） */
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

  if (isGreeting(input)) {
    return buildGreetingReply(input);
  }

  if (user.plan === "pro") {
    const type = detectInputType(input, user.context);
    const scenario = detectScenario(input);
    updateContext(user, input, type, scenario);
    return generateProResponse(input, scenario);
  }

  if (user.count >= FREE_LIMIT) {
    return buildLimitReply(
      user.context.lastAdvice || "今は慎重に動くべき段階です。"
    );
  }

  /* 处理①② */
  if (user.pendingClarify) {
    const original = user.pendingText;
    user.pendingClarify = false;
    user.pendingText = null;

    if (/^(1|①|a)$/i.test(input)) {
      return generateFree(original, user, "partner");
    }

    if (/^(2|②|b)$/i.test(input)) {
      return generateFree(original, user, "situation");
    }

    return generateFree(original, user, "situation");
  }

  const type = detectInputType(input, user.context);

  /* 🔥 unknown才问一次 */
  if (type === "unknown") {
    user.pendingClarify = true;
    user.pendingText = input;
    return buildClarifyReply();
  }

  return generateFree(input, user, type);
}

module.exports = { handleMessage };
