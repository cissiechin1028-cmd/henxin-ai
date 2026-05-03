const { generateAIResponse } = require("./services/ai");
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

  return /^(おはよう|おはようございます|こんにちは|こんばんは|お疲れ様|お疲れ様です|hello|hi)$/i.test(t);
}

function detectGreetingWord(text = "") {
  const t = String(text).trim();

  if (/おはよう/.test(t)) return "おはようございます";
  if (/こんばんは/.test(t)) return "こんばんは";
  if (/こんにちは/.test(t)) return "こんにちは";
  if (/お疲れ/.test(t)) return "お疲れ様です";

  return "こんにちは";
}

function buildGreetingReply(text = "") {
  const g = detectGreetingWord(text);

  return `${g}😊

相手から来たLINEや、
今の状況をそのまま送ってください。

そのまま使える返信を作ります。

例：
「最近忙しいって言われた」
「彼から『少し距離置きたい』って来た」`;
}

function detectInputType(text = "", user = {}) {
  const t = String(text).trim();

  if (!t) return "unknown";

  if (/「.+」/.test(t)) return "partner";

  if (/どう返せば|なんて返せば|返信したい|相談|不安|どうしよ|どうすれば/.test(t)) {
    return "situation";
  }

  if (user.lastInput && /^(次|どうする|返事)$/i.test(t)) {
    return "followup";
  }

  if (t.length <= 2) return "unknown";

  if (t.length <= 20) return "partner";

  return "situation";
}

function buildClarifyReply() {
  return `これ、どっちですか？

① 相手から来たLINE
② 今の状況

番号で送ってください。`;
}

function buildSoftLimitReply() {
  return `ここから先は、開通後に見れます。

開通すると、

・今送るべきか
・どれくらい待つべきか
・どの一言が安全か

まで確認できます。

開通する場合は、
「開通」と送ってください。`;
}

function buildHardPaywallReply() {
  return `続きは開通後にご案内できます。

開通する場合は、
「開通」と送ってください。`;
}

function buildOpenGuideReply() {
  if (PRO_URL) {
    return `開通はこちらからできます👇

${PRO_URL}

開通後、もう一度メッセージを送ってください。`;
  }

  return `開通リンクは現在準備中です。

少し時間を置いてから、
もう一度「開通」と送ってください。`;
}

function attachHint(text, count) {
  if (count === 1) {
    return `${text}

次に迷ったら、
相手の返事をそのまま送ってください。`;
  }

  if (count === 2) {
    return `${text}

続けて見る場合は、
今の不安や相手の返事をそのまま送ってください。`;
  }

  if (count === 3) {
    return `${text}

ここから先は、
「今送るべきか」「どれくらい待つべきか」まで見れます。

続きを見る場合は、
「続き」と送ってください。`;
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

  const ai = await generateAIResponse({
    input,
    userState: {
      inputType,
      scenario,
      context: {
        lastInput: user.lastInput,
        lastInputType: user.lastInputType,
        lastScenario: user.lastScenario,
        lastAdvice: user.lastAdvice
      }
    }
  });

  const updated = incrementReplyUsage(userId);
  const count = updated.usageCount;

  updateUser(userId, {
    lastInput: input,
    lastInputType: inputType,
    lastScenario: scenario,
    lastAdvice: ai
  });

  return attachHint(ai, count);
}

async function handleMessage(userId, text) {
  const input = String(text || "").trim();

  if (!input) return buildClarifyReply();

  if (input === "__reset__") {
    resetUser(userId);
    return "リセットしました";
  }

  const user = getUser(userId);

  if (isGreeting(input)) {
    return buildGreetingReply(input);
  }

  if (/^(開通|申し込み|申込|支払い|決済|購入|どう開通しますか|どう開通します？)$/i.test(input)) {
    return buildOpenGuideReply();
  }

  if (/^(続き|つづき)$/i.test(input)) {
    updateUser(userId, {
      paywallShown: true
    });

    return buildSoftLimitReply();
  }

  if (user.usageCount >= FREE_LIMIT) {
    if (user.paywallShown) {
      return buildHardPaywallReply();
    }

    updateUser(userId, {
      paywallShown: true
    });

    return buildSoftLimitReply();
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

    return generateFree(userId, original, "situation");
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
