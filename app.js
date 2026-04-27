// app.js

const express = require("express");

const detectScene = require("./utils/detectScene");
const detectRisk = require("./utils/detectRisk");
const detectUserAction = require("./utils/detectUserAction");
const decisionEngine = require("./utils/decisionEngine");

const { getOneReply, getReplyTemplates } = require("./replyTemplates");
const { getUser, updateUser } = require("./userStore");
const { replyMessage } = require("./services/line");

const app = express();
app.use(express.json());

// =============================
// 工具
// =============================
function trimText(text = "", max = 1000) {
  return String(text || "").slice(0, max);
}

function normalize(text = "") {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[！!？?。．、,.〜~\s]/g, "");
}

// =============================
// 只认纯打招呼
// =============================
function isGreeting(text = "") {
  const t = normalize(text);

  return [
    "こんにちは",
    "こんばんは",
    "おはよう",
    "おはようございます",
    "hi",
    "hello",
    "hey"
  ].includes(t);
}

// =============================
// ✅ 欢迎语（加好友专用）
// =============================
function welcomeMessage() {
  return `そのLINE、このまま送ると危ないかも。

👇やることはこれだけ
相手のメッセージ、そのまま送って

（コピペ・スクショOK）

そのまま送れる返信、作る。`;
}

// =============================
// ✅ 真人打招呼（用户发）
// =============================
function greetingReply(text = "") {
  const t = normalize(text);

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
// 分流逻辑
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

// =============================
function formatDecisionOnlyOutput(scene) {
  const map = {
    ignore: `👉 今はまだ送らない方が安全です。`,
    break: `👉 今は追いかけない方が安全です。`,
    cold: `👉 今は様子を見るのが安全です。`
  };

  return `【結論】
${map[scene] || "👉 今は無理に動かない方が安全です。"}`;
}

// =============================
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
// LINE webhook
// =============================
app.post("/webhook", async (req, res) => {
  const events = req.body.events || [];

  for (const event of events) {
    try {
      const replyToken = event.replyToken;

      if (!replyToken) continue;

      // ✅ 加好友 → 欢迎语
      if (event.type === "follow") {
        await replyMessage(replyToken, welcomeMessage());
        continue;
      }

      // ✅ 用户消息
      if (event.type === "message" && event.message?.type === "text") {
        const userId = event.source?.userId || "unknown";
        const text = trimText(event.message.text);

        let result;

        if (!text) {
          result = greetingReply("こんにちは");

        } else if (isGreeting(text)) {
          result = greetingReply(text);

        } else {
          result = handleLogic(userId, text);
        }

        await replyMessage(replyToken, result);
      }

    } catch (err) {
      console.error(err);
      await replyMessage(event.replyToken, "エラーが出ました。");
    }
  }

  res.sendStatus(200);
});

// =============================
app.get("/", (req, res) => {
  res.send("OK");
});

// =============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running"));
