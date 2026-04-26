// app.js

const express = require("express");

// ===== utils =====
const detectScene = require("./utils/detectScene");
const detectRisk = require("./utils/detectRisk");
const detectUserAction = require("./utils/detectUserAction");
const decisionEngine = require("./utils/decisionEngine");

// ===== root =====
const { getOneReply, getReplyTemplates } = require("./replyTemplates");
const { getUser, updateUser } = require("./userStore");

const app = express();
app.use(express.json());

// ===== 工具函数 =====
function trimText(text = "", max = 1000) {
  return text.length > max ? text.slice(0, max) : text;
}

function isGreeting(text = "") {
  return ["こんにちは", "こんばんは", "おはよう", "hello", "hi"].some(w =>
    text.toLowerCase().includes(w)
  );
}

// ===== 输出结构 =====
function formatFreeOutput({ decision, reply }) {
  return {
    plan: "free",
    message:
`【結論】
👉 ${decision.conclusion}

【返信】
👉 ${reply}

もっと自然な言い方・別パターン・タイミングまで見たい場合はプレミアムで確認できます。`
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

【送るタイミング】
${decision.sendTiming}

さらに戦略まで見たい場合はPROがおすすめです。`
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

【送るタイミング】
${decision.sendTiming}

【戦略】
${decision.proStrategy}`
  };
}

// ===== API =====
app.get("/", (req, res) => {
  res.send("API running");
});

app.post("/api/chat", (req, res) => {
  try {
    const { userId, message, plan = "free" } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    const input = trimText(message || "");

    if (!input) {
      return res.status(400).json({ error: "message required" });
    }

    // greeting
    if (isGreeting(input)) {
      return res.json({
        message:
`こんにちは😊

相手のメッセージ、そのまま送ってください👇
（コピペ・スクショOK）

そのまま送れる返信、作ります。`
      });
    }

    const user = getUser(userId);

    const scene = detectScene(input);
    const risk = detectRisk({ text: input, scene });
    const action = detectUserAction(input);

    const safePlan = ["free", "premium", "pro"].includes(plan) ? plan : "free";

    // ===== free 限制 =====
    if (safePlan === "free" && user.usageCount >= 3) {
      return res.json({
        locked: true,
        message:
`無料診断は3回までです。

・返信パターン
・送るタイミング
・関係の進め方

はプレミアムで確認できます。`
      });
    }

    const decision = decisionEngine({
      scene,
      risk,
      action,
      plan: safePlan
    });

    let response;

    // ===== FREE =====
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
        action
      });
    }

    // ===== PREMIUM =====
    if (safePlan === "premium") {
      const replies = getReplyTemplates(scene, "premium").slice(0, 3);

      response = formatPremiumOutput({
        decision,
        replies
      });

      updateUser(userId, { scene, risk, action });
    }

    // ===== PRO =====
    if (safePlan === "pro") {
      const replies = getReplyTemplates(scene, "pro").slice(0, 3);

      response = formatProOutput({
        decision,
        replies
      });

      updateUser(userId, { scene, risk, action });
    }

    return res.json({
      scene,
      risk,
      action,
      ...response
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "server error" });
  }
});

// ===== 启动服务器（关键！！！）=====
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
