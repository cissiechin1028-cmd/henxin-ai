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

function isGreeting(text = "") {
  const t = String(text).trim().toLowerCase();

  return /^(おはよう|おはようございます|こんにちは|こんばんは|お疲れ様|お疲れ様です|hello|hi)$/i.test(
    t
  );
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

そのまま使える返信を作ります。`;
}

function detectInputType(text = "", user = {}) {
  const t = String(text).trim();

  if (!t) return "unknown";

  if (/「.+」/.test(t)) return "partner";

  if (/どう返せば|相談|不安/.test(t)) return "situation";

  if (user.lastInput && /^(続き|次)$/i.test(t)) return "followup";

  if (t.length <= 2) return "unknown";

  if (t.length <= 20) return "partner";

  return "situation";
}

function buildClarifyReply() {
  return `これ、どっちですか？

① 相手から来たLINE
② 今の状況`;
}

function buildSoftLimitReply() {
  return `ここから先は、

・今送るべきか
・どれくらい待つべきか
・どの一言が安全か

まで確認できます。

続きは開通後に見れます。`;
}

function buildHardPaywallReply() {
  return `続きは開通後にご案内できます。

この先では、

・相手の温度感
・次にどう動くか
・送るタイミング
・そのまま使える返信

まで確認できます。`;
}

function attachHint(text, count) {
  if (count === 2) {
    return `${text}

※この状況は、次の一言で相手の温度が変わりやすいです。`;
  }

  if (count === 3) {
    return `${text}

ここから先は、
“タイミング”で結果が変わりやすい段階です。`;
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

  if (count === 3) {
    const pro = generateProResponse(input, scenario);
    return attachHint(ai + "\n\n＝＝＝＝＝＝＝＝＝＝\n" + pro, count);
  }

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

  if (/^(続き|つづき)$/i.test(input)) {
    if (user.paywallShown) {
      return buildHardPaywallReply();
    }

    updateUser(userId, {
      paywallShown: true,
      usageCount: Math.max(user.usageCount, FREE_LIMIT + 2)
    });

    return buildSoftLimitReply();
  }

  if (user.usageCount >= FREE_LIMIT + 2) {
    return buildHardPaywallReply();
  }

  if (user.usageCount === FREE_LIMIT + 1) {
    updateUser(userId, {
      usageCount: user.usageCount + 1,
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
