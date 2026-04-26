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

// ===== LINE =====
const { replyMessage } = require("./services/line");

const app = express();
app.use(express.json());

function trimText(text = "", max = 1000) {
  if (!text) return "";
  return String(text).length > max ? String(text).slice(0, max) : String(text);
}

function isGreeting(text = "") {
  const t = String(text).toLowerCase();
  return ["こんにちは", "こんばんは", "おはよう", "hello", "hi"].some(w =>
    t.includes(w)
  );
}

function welcomeMessage() {
  return `そのLINE、このまま送ると危ないかも。

👇やることはこれだけ
相手のメッセージ、そのまま送って

（コピペ・スクショOK）

そのまま送れる返信、作る。`;
}

function formatFreeOutput({ decision, reply }) {
  return `【結論】
👉 ${decision.conclusion}

【返信】
👉 ${reply}

もっと自然な言い方・別パターン・タイミングまで見たい場合はプレミアムで確認できます。`;
}

function formatPremiumOutput({ decision, replies }) {
  return `【結論】
👉 ${decision.conclusion}

【理由】
${decision.reason}

【おすすめ返信】
1. ${replies[0]}
2. ${replies[1]}
3. ${replies[2]}

【送るタイミング】
${decision.sendTiming}

さらに戦略まで見たい場合はPROがおすすめです。`;
}

function formatProOutput({ decision, replies }) {
  return `【結論】
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
${decision.proStrategy}`;
}

function handleLogic(userId, input, plan = "free") {
  const safePlan = ["free", "premium", "pro"].includes(plan) ? plan : "free";
  const user = getUser(userId);

  const scene = detectScene(input);
  const risk = detectRisk({ text: input, scene });
  const action = detectUserAction(input);

  if (safePlan === "free" && user.usageCount >= 3) {
    return `無料診断は3回までです。

・返信パターン
・送るタイミング
・関係の進め方

はプレミアムで確認できます。`;
  }

  const decision = decisionEngine({
    scene,
    risk,
    action,
    plan: safePlan
  });

  if (safePlan === "free") {
    const reply = getOneReply(scene, "free");

    updateUser(userId, {
      usageCount: user.usageCount + 1,
      scene,
      risk,
      action,
      plan: safePlan
    });

    return formatFreeOutput({ decision, reply });
  }

  if (safePlan === "premium") {
    const replies = getReplyTemplates(scene, "premium").slice(0, 3);

    updateUser(userId, {
      scene,
      risk,
      action,
      plan: safePlan
    });

    return formatPremiumOutput({ decision, replies });
  }

  if (safePlan === "pro") {
    const replies = getReplyTemplates(scene, "pro").slice(0, 3);

    updateUser(userId, {
      scene,
      risk,
      action,
      plan: safePlan
    });

    return formatProOutput({ decision, replies });
  }

  return "うまく判断できませんでした。もう少し詳しく送ってください。";
}

// ===== health check =====
app.get("/", (req, res) => {
  res.send("API running");
});

// ===== LINE webhook =====
app.post("/webhook", async (req, res) => {
  const processedReplyTokens = new Set();

  try {
    const events = req.body.events || [];

    console.log("LINE webhook received:", JSON.stringify(events));

    for (const event of events) {
      const replyToken = event.replyToken;

      if (!replyToken) {
        console.log("No replyToken, skipped");
        continue;
      }

      if (processedReplyTokens.has(replyToken)) {
        console.log("Duplicate replyToken, skipped:", replyToken);
        continue;
      }

      processedReplyTokens.add(replyToken);

      // 加好友
      if (event.type === "follow") {
        console.log("Follow event:", event.source?.userId);

        await replyMessage(replyToken, welcomeMessage());
        continue;
      }

      // 文字消息
      if (event.type === "message" && event.message?.type === "text") {
        const userId = event.source?.userId || "unknown_user";
        const text = trimText(event.message.text);

        console.log("Message from:", userId, "text:", text);

        if (!text || isGreeting(text)) {
          await replyMessage(replyToken, welcomeMessage());
          continue;
        }

        const result = handleLogic(userId, text, "free");

        console.log("Reply result:", result);

        await replyMessage(replyToken, result);
        continue;
      }

      console.log("Unsupported event skipped:", event.type);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err.response?.data || err.message || err);
    return res.sendStatus(200);
  }
});

// ===== API测试接口 =====
app.post("/api/chat", (req, res) => {
  try {
    const { userId = "test_user", message, plan = "free" } = req.body;
    const input = trimText(message || "");

    if (!input) {
      return res.status(400).json({ error: "message required" });
    }

    if (isGreeting(input)) {
      return res.json({
        message: welcomeMessage()
      });
    }

    const result = handleLogic(userId, input, plan);

    return res.json({
      message: result
    });
  } catch (err) {
    console.error("API error:", err);
    return res.status(500).json({ error: "server error" });
  }
});

// ===== start =====
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
