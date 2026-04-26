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
  return `【結論】
👉 ${decision.conclusion}

【返信】
👉 ${reply}

もっと自然な言い方・別パターン・タイミングまで見たい場合はプレミアムで確認できます。`;
}

// ===== 核心处理逻辑 =====
function handleLogic(userId, input) {
  const user = getUser(userId);

  const scene = detectScene(input);
  const risk = detectRisk({ text: input, scene });
  const action = detectUserAction(input);

  const decision = decisionEngine({
    scene,
    risk,
    action,
    plan: "free"
  });

  const reply = getOneReply(scene, "free");

  updateUser(userId, {
    usageCount: user.usageCount + 1,
    scene,
    risk,
    action
  });

  return formatFreeOutput({ decision, reply });
}

// ===== LINE webhook =====
app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events;

    for (const event of events) {
      if (event.type !== "message" || event.message.type !== "text") {
        continue;
      }

      const userId = event.source.userId;
      const text = trimText(event.message.text);
      const replyToken = event.replyToken;

      // greeting
      if (isGreeting(text)) {
        await replyMessage(
          replyToken,
          `こんにちは😊

相手のメッセージ、そのまま送ってください👇
（コピペ・スクショOK）

そのまま送れる返信、作ります。`
        );
        continue;
      }

      const result = handleLogic(userId, text);

      await replyMessage(replyToken, result);
    }

    res.sendStatus(200);

  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// ===== 测试接口（保留）=====
app.post("/api/chat", (req, res) => {
  const { userId, message } = req.body;

  const result = handleLogic(userId, message);

  res.json({ message: result });
});

// ===== 启动服务器 =====
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
