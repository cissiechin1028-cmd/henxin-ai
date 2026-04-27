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

// ===== line =====
const { replyMessage } = require("./services/line");

const app = express();
app.use(express.json());

// =============================
// 工具
// =============================
function trimText(text = "", max = 1000) {
  return String(text || "").slice(0, max);
}

// 只认纯打招呼
function isGreeting(text = "") {
  const t = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[！!？?。．、,.〜~\s]/g, "");

  const greetings = [
    "こんにちは",
    "こんばんは",
    "おはよう",
    "おはようございます",
    "hi",
    "hello",
    "hey"
  ];

  return greetings.includes(t);
}

// =============================
// ✅ 只改这里（你的要求）
// =============================
function greetingReply(text = "") {
  const t = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[！!？?。．、,.〜~\s]/g, "");

  if (t.includes("おはよう")) {
    return `おはよう😊
何か話したいことや、相手とのやりとりがあれば教えてね。
一緒に考えるよ。`;
  }

  if (t.includes("こんばんは")) {
    return `こんばんは😊
何か話したいことや、相手とのやりとりがあれば教えてね。
一緒に考えるよ。`;
  }

  if (t.includes("こんにちは")) {
    return `こんにちは😊
何か話したいことや、相手とのやりとりがあれば教えてね。
一緒に考えるよ。`;
  }

  return `こんにちは😊
何か話したいことや、相手とのやりとりがあれば教えてね。
一緒に考えるよ。`;
}

// =============================
// 分流逻辑（不动你已有结构）
// =============================
function decideMode({ scene, action }) {
  if (scene === "ignore" && (action === "none" || action === "no_reply")) {
    return "judge";
  }

  if (scene === "break" && action !== "sent") {
    return "judge";
  }

  if (scene === "cold" && action !== "sent") {
    return "judge";
  }

  return "reply";
}

function formatDecisionOnlyOutput(scene) {
  const map = {
    ignore: `👉 今はまだ送らない方が安全です。`,
    break: `👉 今は追いかけない方が安全です。`,
    cold: `👉 今は様子を見るのが安全です。`
  };

  return `【結論】
${map[scene] || "👉 今は無理に動かない方が安全です。"}`;
}

function formatFreeOutput(decision, reply) {
  return `【結論】
👉 ${decision.conclusion}

【返信】
👉 ${reply}`;
}

// =============================
// 核心逻辑
// =============================
function handleLogic(userId, input) {
  const user = getUser(userId);

  const scene = detectScene(input);
  const risk = detectRisk({ text: input, scene });
  const action = detectUserAction(input);

  const mode = decideMode({ scene, action });

  if (mode === "judge") {
    updateUser(userId, { usageCount: user.usageCount + 1 });
    return formatDecisionOnlyOutput(scene);
  }

  const decision = decisionEngine({ scene, risk, action });

  const reply = getOneReply(scene, "free");

  updateUser(userId, { usageCount: user.usageCount + 1 });

  return formatFreeOutput(decision, reply);
}

// =============================
// webhook（LINE）
// =============================
app.post("/webhook", async (req, res) => {
  const events = req.body.events || [];

  for (const event of events) {
    try {
      if (event.type !== "message" || event.message.type !== "text") continue;

      const userId = event.source.userId;
      const text = trimText(event.message.text);

      let result;

      if (!text) {
        result = greetingReply("こんにちは");
      } else if (isGreeting(text)) {
        result = greetingReply(text);
      } else {
        result = handleLogic(userId, text);
      }

      await replyMessage(event.replyToken, result);

    } catch (err) {
      console.error(err);
      await replyMessage(event.replyToken, "エラーが出ました。");
    }
  }

  res.sendStatus(200);
});

// =============================
// API测试
// =============================
app.post("/api/chat", (req, res) => {
  const { userId = "test", message } = req.body;
  const input = trimText(message);

  let result;

  if (!input) {
    result = greetingReply("こんにちは");
  } else if (isGreeting(input)) {
    result = greetingReply(input);
  } else {
    result = handleLogic(userId, input);
  }

  res.json({ message: result });
});

// =============================
app.get("/", (req, res) => {
  res.send("OK");
});

// =============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running"));
