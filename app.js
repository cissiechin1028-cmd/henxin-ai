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

function trimText(text = "", max = 1000) {
  return String(text || "").slice(0, max);
}

function normalizeGreeting(text = "") {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[！!？?。．、,.〜~\s]/g, "");
}

function isGreeting(text = "") {
  const t = normalizeGreeting(text);

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

function greetingReply(text = "こんにちは") {
  const t = normalizeGreeting(text);

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

function formatDecisionOnlyOutput({ scene }) {
  const map = {
    ignore: `👉 今はまだ送らない方が安全です。

既読無視の状態で追うと、
一気に「重い」と感じられやすいです。

今は👇
・追わない
・少し時間を空ける
・相手の負担を増やさない

が一番安全です。`,

    break: `👉 今は追いかけない方が安全です。

強く出ると関係が一気に崩れます。

一度落ち着くのが最優先です。`,

    cold: `👉 今は様子を見るのが安全です。

ここで踏み込むと、
さらに距離が開く可能性があります。`
  };

  return `【結論】
${map[scene] || "👉 今は無理に動かない方が安全です。"}

──
このあと👇
・いつ送るべきか
・送るなら何て送るべきか
・相手の本音の見方

はプレミアムで見れます。`;
}

function formatFreeOutput({ decision, reply }) {
  return `【結論】
👉 ${decision.conclusion}

【返信】
👉 ${reply}

──
この返信でも大きく外しません。

でも👇
・もっと自然な言い方
・相手が返したくなる一言
・距離を縮める返し方

はプレミアムで見れます。`;
}

function formatPremiumOutput({ decision, replies }) {
  return `【結論】
👉 ${decision.conclusion}

【理由】
${decision.reason}

【おすすめ返信】
① ${replies[0]}
② ${replies[1]}
③ ${replies[2]}

【送るタイミング】
${decision.sendTiming}`;
}

function formatProOutput({ decision, replies }) {
  return `【結論】
👉 ${decision.conclusion}

【リスク判断】
${decision.reason}

【今取るべき行動】
${decision.action}

【返信候補】
① ${replies[0]}
② ${replies[1]}
③ ${replies[2]}

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
  const mode = decideMode({ scene, action });

  if (safePlan === "free" && user.usageCount >= 3) {
    return `無料診断は3回までです。

ここから先は👇
・返信パターン
・送るタイミング
・関係の進め方

をプレミアムで確認できます。`;
  }

  if (safePlan === "free" && mode === "judge") {
    updateUser(userId, {
      usageCount: user.usageCount + 1,
      scene,
      risk,
      action,
      mode,
      plan: safePlan
    });

    return formatDecisionOnlyOutput({ scene });
  }

  const decision = decisionEngine({
    scene,
    risk,
    action,
    plan: safePlan
  });

  if (!decision || !decision.conclusion) {
    return "もう一度送ってください。";
  }

  if (safePlan === "free") {
    const reply = getOneReply(scene, "free");

    updateUser(userId, {
      usageCount: user.usageCount + 1,
      scene,
      risk,
      action,
      mode,
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
      mode,
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
      mode,
      plan: safePlan
    });

    return formatProOutput({ decision, replies });
  }

  return "もう一度送ってください。";
}

app.get("/", (req, res) => {
  res.status(200).send("API running");
});

app.post("/webhook", async (req, res) => {
  const events = req.body.events || [];

  for (const event of events) {
    try {
      const replyToken = event.replyToken;

      if (!replyToken) continue;

      // ✅ 加好友欢迎语
      if (event.type === "follow") {
        await replyMessage(replyToken, greetingReply("こんにちは"));
        continue;
      }

      // ✅ 普通文字消息
      if (event.type === "message" && event.message?.type === "text") {
        const userId = event.source?.userId || "unknown_user";
        const text = trimText(event.message.text);

        let result;

        if (!text) {
          result = greetingReply("こんにちは");
        } else if (isGreeting(text)) {
          result = greetingReply(text);
        } else {
          result = handleLogic(userId, text, "free");
        }

        await replyMessage(replyToken, result);
      }
    } catch (err) {
      console.error("WEBHOOK ERROR:", err.stack || err.message || err);

      try {
        if (event.replyToken) {
          await replyMessage(
            event.replyToken,
            "エラーが出ました。もう一度送ってください。"
          );
        }
      } catch (replyErr) {
        console.error("ERROR REPLY FAILED:", replyErr.response?.data || replyErr.message);
      }
    }
  }

  return res.sendStatus(200);
});

app.post("/api/chat", (req, res) => {
  try {
    const { userId = "test_user", message, plan = "free" } = req.body;
    const input = trimText(message || "");

    let result;

    if (!input) {
      result = greetingReply("こんにちは");
    } else if (isGreeting(input)) {
      result = greetingReply(input);
    } else {
      result = handleLogic(userId, input, plan);
    }

    return res.json({ message: result });
  } catch (err) {
    console.error("API ERROR:", err.stack || err.message || err);
    return res.status(500).json({
      message: "エラーが出ました。もう一度送ってください。"
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
