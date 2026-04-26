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
  const s = String(text || "");
  return s.length > max ? s.slice(0, max) : s;
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

  console.log("DEBUG:", { input, scene, risk, action, safePlan, user });

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

  console.log("DECISION:", decision);

  if (!decision || !decision.conclusion) {
    throw new Error("decisionEngine returned invalid result");
  }

  if (safePlan === "free") {
    const reply = getOneReply(scene, "free");

    console.log("SELECTED REPLY:", reply);

    if (!reply) {
      throw new Error(`No reply template found for scene: ${scene}`);
    }

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

  throw new Error("Unknown plan");
}

app.get("/", (req, res) => {
  res.status(200).send("API running");
});

app.post("/webhook", async (req, res) => {
  const events = req.body.events || [];

  console.log("WEBHOOK EVENTS:", JSON.stringify(events));

  for (const event of events) {
    try {
      const replyToken = event.replyToken;

      if (!replyToken) {
        console.log("NO REPLY TOKEN");
        continue;
      }

      if (event.type === "follow") {
        await replyMessage(replyToken, welcomeMessage());
        continue;
      }

      if (event.type === "message" && event.message?.type === "text") {
        const userId = event.source?.userId || "unknown_user";
        const text = trimText(event.message.text);

        console.log("USER TEXT:", text);

        let result;

        if (!text || isGreeting(text)) {
          result = welcomeMessage();
        } else {
          result = handleLogic(userId, text, "free");
        }

        console.log("REPLY TEXT:", result);

        await replyMessage(replyToken, result);
        continue;
      }

      console.log("UNSUPPORTED EVENT:", event.type);
    } catch (err) {
      console.error("🔥 WEBHOOK REAL ERROR:", err.stack || err.message || err);

      try {
        if (event.replyToken) {
          await replyMessage(
            event.replyToken,
            "エラーが出ました。もう一度メッセージを送ってください。"
          );
        }
      } catch (replyErr) {
        console.error("🔥 ERROR REPLY FAILED:", replyErr.response?.data || replyErr.message);
      }
    }
  }

  return res.sendStatus(200);
});

app.post("/api/chat", (req, res) => {
  try {
    const { userId = "test_user", message, plan = "free" } = req.body;
    const input = trimText(message || "");

    if (!input) {
      return res.status(400).json({ error: "message required" });
    }

    if (isGreeting(input)) {
      return res.json({ message: welcomeMessage() });
    }

    const result = handleLogic(userId, input, plan);

    return res.json({ message: result });
  } catch (err) {
    console.error("🔥 API REAL ERROR:", err.stack || err.message || err);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
