// messageHandler.js

const { generateAIResponse } = require("./services/ai");
const { generateProResponse } = require("./services/proEngine");
const { classifyMessage } = require("./services/messageClassifier");
const { detectScenario } = require("./services/scenarioDetector");
const { detectRiskLevel, getRiskJudge } = require("./services/riskLevel");
const {
  getUser,
  updateUser,
  incrementReplyUsage,
  incrementCriticalUsage
} = require("./userStore");

const FREE_REPLY_LIMIT = 3;

function buildGreetingReply() {
  return `こんにちは😊

相手から来たLINEや、今の状況をそのまま送ってください。

たとえば、

「最近返信が冷たい」
「既読無視されてる」
「この返事どう返せばいい？」
「相手から来た文面をそのまま貼る」

そのまま送れる返信を作ります。`;
}

function buildThanksReply() {
  return `こちらこそです😊

相手から新しく来たLINEや、
今の状況が変わったらそのまま送ってください。`;
}

function buildSituationReply(text, scenario, riskLevel) {
  const judge = getRiskJudge(riskLevel, scenario);

  if (riskLevel >= 4) {
    return `${judge}

ここで長文や強い言い方をすると、
相手の気持ちがさらに離れやすくなります。

相手から来た文面があれば、
そのまま貼ってください。

その文面に合わせて、
重く見えない返し方を作ります。`;
  }

  if (scenario === "ignore") {
    return `${judge}

ここで何度も送ると、
「返さなきゃ」という負担だけが残りやすいです。

相手から最後に来た文面があれば、
そのまま送ってください。

今送っていい一文に整えます。`;
  }

  if (scenario === "cold") {
    return `${judge}

原因を聞きすぎるより、
まずは相手の温度を見た方が安全です。

相手から来た文面があれば、
そのまま貼ってください。

自然に返せる形にします。`;
  }

  if (scenario === "reunion") {
    return `${judge}

いきなり気持ちを伝えるより、
まずは相手の警戒を下げる返し方が必要です。

相手との直近のLINEがあれば、
そのまま送ってください。

復縁感が出すぎない文に整えます。`;
  }

  if (scenario === "cheating") {
    return `${judge}

まだ確定していない段階で責めると、
相手が本音を隠しやすくなります。

相手の文面や直近のやり取りを送ってください。

問い詰めずに反応を見られる返し方を作ります。`;
  }

  return `${judge}

相手から来た文面があれば、
そのまま送ってください。

相手に送れる形に整えます。`;
}

function buildUnclearReply() {
  return `これは、

相手から来たLINEですか？
それとも、今の状況説明ですか？

相手に返したい文面なら、
そのままコピペして送ってください。

状況説明なら、
「最近返信が冷たい」みたいに送ってくれれば大丈夫です。`;
}

function buildLimitReply(scenario, riskLevel) {
  if (riskLevel >= 3) {
    return `ここからは、返し方を間違えると関係が動きやすい場面です。

今の状況では、
「何を送るか」だけでなく、
「いつ送るか」「どこまで踏み込むか」も大事です。`;
  }

  return `ここからは、言い方の細かい温度感が大事です。

相手に重く見えない形で整える必要があります。`;
}

function cleanAIText(aiText, riskLevel, scenario) {
  let text = String(aiText || "").trim();

  text = text.replace(/詳しく見るならProで確認できます。?/g, "");
  text = text.replace(/自然な言い方はプレミアムで確認できます。?/g, "");
  text = text.replace(/Pro/g, "");
  text = text.replace(/プレミアム/g, "");
  text = text.replace(/有料/g, "");

  if (!text.includes("👇 送るなら")) {
    return `${getRiskJudge(riskLevel, scenario)}

👇 送るなら
「無理しないでね。落ち着いたらまた話そ😊」

⚠️ ここだけ注意
ここで寂しさを強く出すと、相手に負担として伝わりやすいです。`;
  }

  return text.trim();
}

async function handleMessage(userId, text) {
  const input = String(text || "").trim();
  const user = getUser(userId);

  const inputType = classifyMessage(input);
  const scenario = detectScenario(input);
  const riskLevel = detectRiskLevel(input, scenario);

  updateUser(userId, {
    lastInputType: inputType,
    lastScenario: scenario,
    lastRiskLevel: riskLevel
  });

  if (inputType === "empty") {
    return buildGreetingReply();
  }

  if (inputType === "greeting") {
    return buildGreetingReply();
  }

  if (inputType === "thanks") {
    return buildThanksReply();
  }

  if (inputType === "situation") {
    if (riskLevel >= 3) {
      incrementCriticalUsage(userId);
    }

    return buildSituationReply(input, scenario, riskLevel);
  }

  if (inputType === "unclear") {
    return buildUnclearReply();
  }

  if (inputType === "partner_message") {
    if (user.plan === "pro") {
      return generateProResponse(input, scenario);
    }

    if (user.replyUsageCount >= FREE_REPLY_LIMIT) {
      return buildLimitReply(scenario, riskLevel);
    }

    const aiText = await generateAIResponse({
      input,
      userState: {
        inputType,
        scenario,
        riskLevel,
        usageCount: user.replyUsageCount
      }
    });

    incrementReplyUsage(userId);

    return cleanAIText(aiText, riskLevel, scenario);
  }

  return buildUnclearReply();
}

module.exports = { handleMessage };
