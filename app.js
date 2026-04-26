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

function getFreeTip(decision) {
  const map = {
    "今は理解を見せる返信が安全です":
      "“忙しい中でも返してくれたこと”に触れると印象が上がります",

    "今は責めずに、やさしく受け止めるのが安全です":
      "“忙しい中でも返してくれたこと”に触れると印象が上がります",

    "今は軽く気遣う返信が安全です":
      "“返さなくても大丈夫”という空気を出すと、逆に返ってきやすくなります",

    "今は相手の温度を確認しながら進めるのが安全です":
      "踏み込むより、“ちょっと気になった”くらいがちょうどいいです",

    "今は感情的に追いかけすぎない方が安全です":
      "ここで強く出ると、一気に距離が開くので注意です",

    "今は少し好意を見せても大丈夫です":
      "ストレートに言うより、“話していて楽しい”の方が自然です",

    "今は自然に短く返すのが安全です":
      "長く説明するより、短く返す方が自然に続きやすいです"
  };

  return map[decision.conclusion] || "相手の負担を下げる言い方がポイントです";
}

function formatFreeOutput({ decision, reply }) {
  return `【結論】
👉 ${decision.conclusion}

【返信】
👉 ${reply}

💡ワンポイント
👉 ${getFreeTip(decision)}

──
このままでもOKですが👇
・もっと自然な言い方
・相手が返しやすい言い方
・距離を縮める言い方

はプレミアムで見れます。`;
}

function formatPremiumOutput({ decision, replies }) {
  return `【結論】
👉 ${decision.conclusion}

【理由】
${decision.reason}

【おすすめ返信】
① ${replies[0]}
→ 自然で安全

② ${replies[1]}
→ 少し距離を縮める

③ ${replies[2]}
→ やさしめ

【送るタイミング】
${decision.sendTiming}

──
💡この中で一番いい返し方や、
相手がどう受け取りやすいかはPROで確認できます。`;
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

  console.log("DEBUG:", { input, scene, risk, action, safePlan, user });

  if (safePlan === "free" && user.usageCount >= 3) {
    return `無料診断は3回までです。

ここから先は👇
・返信パターン
・送るタイミング
・関係の進め方

をプレミアムで確認できます。`;
  }

  const decision = decisionEngine({
    scene,
    risk,
    action,
    plan: safePlan
  });

  if (!decision || !decision.conclusion) {
    throw new Error("decisionEngine returned invalid result");
  }

  if (safePlan === "free") {
    const reply = getOneReply(scene, "free");

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
      console.error("WEBHOOK ERROR:", err.stack || err.message || err);

      try {
        if (event.replyToken) {
          await replyMessage(
            event.replyToken,
            "エラーが出ました。もう一度メッセージを送ってください。"
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

    if (!input) {
      return res.status(400).json({ error: "message required" });
    }

    if (isGreeting(input)) {
      return res.json({ message: welcomeMessage() });
    }

    const result = handleLogic(userId, input, plan);

    return res.json({ message: result });
  } catch (err) {
    console.error("API ERROR:", err.stack || err.message || err);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
