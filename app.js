// app.js

const express = require("express");

// ===== utils =====
const detectScene = require("./utils/detectScene");
const detectRisk = require("./utils/detectRisk");
const { detectUserAction } = require("./utils/detectUserAction");
const decisionEngine = require("./utils/decisionEngine");

// ===== root =====
const { getOneReply, getReplyTemplates } = require("./replyTemplates");
const { getUser, updateUser } = require("./userStore");

// ===== line =====
const { replyMessage } = require("./services/line");

const app = express();
app.use(express.json());

// =============================
// 基础工具
// =============================
function trimText(text = "", max = 1000) {
  return String(text || "").slice(0, max);
}

function isGreeting(text = "") {
  return ["こんにちは", "こんばんは", "おはよう", "hello", "hi"].some(w =>
    text.toLowerCase().includes(w)
  );
}

// =============================
// 真人打招呼
// =============================
function greetingReply() {
  const variants = [
    `こんにちは😊
来てくれてありがとう。

そのLINE、そのまま送って👇
一緒に見てみるよ。`,

    `こんにちは😊
どうしたの？

やり取りそのまま送って👇
ちゃんと見るよ。`,

    `こんにちは😊
大丈夫、気軽でいいよ。

相手のメッセージそのまま見せて👇`
  ];

  return variants[Math.floor(Math.random() * variants.length)];
}

// =============================
// 分流核心（所有场景）
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
// 判断输出（统一）
// =============================
function formatDecisionOnlyOutput(scene) {
  const map = {
    ignore: `👉 今はまだ送らない方が安全です。
既読無視で追うと一気に重く見えます。`,

    break: `👉 今は追いかけない方が安全です。
強く出ると関係が崩れます。`,

    cold: `👉 今は様子を見るのが安全です。
ここで踏み込むと距離が開きます。`,

    explain: `👉 今は責めずに受け止めるのが安全です。`
  };

  return `【結論】
${map[scene] || "👉 今は無理に動かない方が安全です。"}

──
このあと👇
・送るべきか
・いつ送るべきか
・何て送るべきか

はプレミアムで見れます。`;
}

// =============================
// FREE输出
// =============================
function formatFreeOutput(decision, reply) {
  return `【結論】
👉 ${decision.conclusion}

【返信】
👉 ${reply}

──
この返信でも大きく外しません。

でも👇
・もっと自然な言い方
・相手が返したくなる一言

はプレミアムで見れます。`;
}

// =============================
// PREMIUM
// =============================
function formatPremiumOutput(decision, replies) {
  return `【結論】
👉 ${decision.conclusion}

【返信】
① ${replies[0]}
② ${replies[1]}
③ ${replies[2]}

【タイミング】
${decision.sendTiming}`;
}

// =============================
// PRO
// =============================
function formatProOutput(decision, replies) {
  return `【結論】
👉 ${decision.conclusion}

【行動】
${decision.action}

【返信】
① ${replies[0]}
② ${replies[1]}
③ ${replies[2]}

【戦略】
${decision.proStrategy}`;
}

// =============================
// 核心逻辑（永远有返回）
// =============================
function handleLogic(userId, input, plan = "free") {
  try {
    const user = getUser(userId);

    const scene = detectScene(input);
    const risk = detectRisk({ text: input, scene });
    const action = detectUserAction(input);

    const mode = decideMode({ scene, action });

    // ===== judge =====
    if (mode === "judge") {
      updateUser(userId, { usageCount: user.usageCount + 1 });
      return formatDecisionOnlyOutput(scene);
    }

    const decision = decisionEngine({ scene, risk, action, plan });

    // ===== FREE =====
    if (plan === "free") {
      const reply = getOneReply(scene, "free");

      updateUser(userId, { usageCount: user.usageCount + 1 });

      return formatFreeOutput(decision, reply);
    }

    // ===== PREMIUM =====
    if (plan === "premium") {
      const replies = getReplyTemplates(scene, "premium").slice(0, 3);
      return formatPremiumOutput(decision, replies);
    }

    // ===== PRO =====
    if (plan === "pro") {
      const replies = getReplyTemplates(scene, "pro").slice(0, 3);
      return formatProOutput(decision, replies);
    }

    return "もう一度送ってください。";

  } catch (e) {
    console.error("handleLogic error:", e);
    return "エラーが出ました。もう一度送ってください。";
  }
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
        result = greetingReply();

      } else if (isGreeting(text)) {
        result = greetingReply();

      } else {
        result = handleLogic(userId, text, "free");
      }

      await replyMessage(event.replyToken, result);

    } catch (err) {
      console.error("webhook error:", err);

      try {
        await replyMessage(event.replyToken, "エラーが出ました。");
      } catch (e) {}
    }
  }

  res.sendStatus(200);
});

// =============================
// 测试API
// =============================
app.post("/api/chat", (req, res) => {
  try {
    const { userId = "test", message } = req.body;

    const input = trimText(message);

    let result;

    if (!input) {
      result = greetingReply();
    } else if (isGreeting(input)) {
      result = greetingReply();
    } else {
      result = handleLogic(userId, input);
    }

    res.json({ message: result });

  } catch (e) {
    res.json({ message: "エラー" });
  }
});

// =============================
app.get("/", (req, res) => {
  res.send("OK");
});

// =============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running"));
