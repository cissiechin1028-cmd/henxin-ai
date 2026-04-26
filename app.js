// app.js

const express = require("express");

const detectScene = require("./detectScene");
const detectRisk = require("./detectRisk");
const detectUserAction = require("./detectUserAction");
const decisionEngine = require("./decisionEngine");

const {
  getOneReply,
  getReplyTemplates
} = require("./replyTemplates");

const {
  getUser,
  updateUser
} = require("./userStore");

const app = express();
app.use(express.json());

function isGreeting(text = "") {
  const t = text.trim().toLowerCase();

  return [
    "hi",
    "hello",
    "hey",
    "こんにちは",
    "こんばんは",
    "おはよう",
    "はじめまして"
  ].some(word => t.includes(word));
}

function trimText(text = "", max = 1200) {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) : text;
}

function formatFreeOutput({ decision, reply }) {
  return {
    plan: "free",
    message:
`【結論】
👉 ${decision.conclusion}

【返信】
👉 ${reply}

もっと自然な言い方・別パターン・送るタイミングまで見たい場合は、プレミアムで確認できます。`
  };
}

function formatPremiumOutput({ decision, replies }) {
  return {
    plan: "premium",
    message:
`【結論】
👉 ${decision.conclusion}

【理由】
${decision.reason}

【おすすめ返信】
1. ${replies[0]}
2. ${replies[1]}
3. ${replies[2]}

【おすすめの雰囲気】
${decision.tone}

【送るタイミング】
${decision.sendTiming}

さらに「送るべきか・待つべきか」「関係の流れ」まで見たい場合はPROで確認できます。`
  };
}

function formatProOutput({ decision, replies }) {
  return {
    plan: "pro",
    message:
`【結論】
👉 ${decision.conclusion}

【リスク判断】
${decision.reason}

【今取るべき行動】
${decision.action}

【返信候補】
1. ${replies[0]}
2. ${replies[1]}
3. ${replies[2]}

【おすすめの雰囲気】
${decision.tone}

【送るタイミング】
${decision.sendTiming}

【PRO戦略】
${decision.proStrategy}`
  };
}

app.post("/api/chat", async (req, res) => {
  try {
    const {
      userId,
      message,
      plan = "free"
    } = req.body;

    if (!userId) {
      return res.status(400).json({
        error: "userId is required"
      });
    }

    const input = trimText(message || "");

    if (!input) {
      return res.status(400).json({
        error: "message is required"
      });
    }

    if (isGreeting(input)) {
      return res.json({
        message:
`こんにちは😊
相手とのLINE内容や、今の状況を送ってください。

例：
・既読無視されてる
・返信が冷たい
・忙しいって言われた
・好きバレしたかも
・別れ話になってる`
      });
    }

    const user = getUser(userId);

    const scene = detectScene(input);
    const risk = detectRisk({ text: input, scene });
    const action = detectUserAction(input);

    const safePlan = ["free", "premium", "pro"].includes(plan) ? plan : "free";

    // free制限
    if (safePlan === "free" && user.usageCount >= 3) {
      return res.json({
        locked: true,
        message:
`無料診断は3回までです。

ここから先は、
・返信パターン
・送るタイミング
・相手の温度感
まで見られるプレミアムで確認できます。`
      });
    }

    // critical / break はPRO誘導
    if ((risk === "critical" || scene === "break") && safePlan !== "pro") {
      user.criticalUsageCount = (user.criticalUsageCount || 0) + 1;

      // ただし完全ロックしない。freeでも1回は返信を出す
      const decision = decisionEngine({
        scene,
        risk,
        action,
        plan: safePlan
      });

      const reply = getOneReply(scene, "free");

      updateUser(userId, {
        usageCount: user.usageCount + 1,
        criticalUsageCount: user.criticalUsageCount,
        scene,
        risk,
        action,
        plan: safePlan
      });

      return res.json({
        locked: false,
        proRecommended: true,
        message:
`【結論】
👉 ${decision.conclusion}

【返信】
👉 ${reply}

※これは別れ・復縁に近い高リスク場面です。
送るタイミングや、追うべきか待つべきかまで判断するにはPROがおすすめです。`
      });
    }

    const decision = decisionEngine({
      scene,
      risk,
      action,
      plan: safePlan
    });

    let response;

    if (safePlan === "free") {
      const reply = getOneReply(scene, "free");

      response = formatFreeOutput({
        decision,
        reply
      });

      updateUser(userId, {
        usageCount: user.usageCount + 1,
        scene,
        risk,
        action,
        plan: safePlan
      });
    }

    if (safePlan === "premium") {
      const replies = getReplyTemplates(scene, "premium").slice(0, 3);

      response = formatPremiumOutput({
        decision,
        replies
      });

      updateUser(userId, {
        scene,
        risk,
        action,
        plan: safePlan
      });
    }

    if (safePlan === "pro") {
      const replies = getReplyTemplates(scene, "pro").slice(0, 3);

      response = formatProOutput({
        decision,
        replies
      });

      updateUser(userId, {
        scene,
        risk,
        action,
        plan: safePlan
      });
    }

    return res.json({
      scene,
      risk,
      action,
      ...response
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "server error"
    });
  }
});

module.exports = app;
