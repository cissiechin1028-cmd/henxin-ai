// app.js

const express = require("express");

const detectScene = require("./utils/detectScene");
const detectRisk = require("./utils/detectRisk");
const detectUserAction = require("./utils/detectUserAction");
const decisionEngine = require("./utils/decisionEngine");

const { getOneReply, getReplyTemplates } = require("./replyTemplates");
const { getUser, updateUser } = require("./userStore");

const { replyMessage } = require("./services/line");

const { pickStyle, getStyleLabel } = require("./styleEngine");
const composeReply = require("./replyComposer");

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

function getFreeTip({ decision, scene }) {
  if (scene === "explain") {
    return `この一言で「いい人止まり」になるか決まります。
“忙しい中でも返してくれたこと”に触れると、ただ優しいだけじゃなく、印象に残りやすくなります。`;
  }

  if (scene === "ignore") {
    return `ここで追うと一気に重く見えます。
“返さなくても大丈夫”の空気を出すと、相手が戻ってきやすくなります。`;
  }

  if (scene === "cold") {
    return `ここで詰めると、さらに温度が下がります。
“少し気になっただけ”くらいで止めるのが一番安全です。`;
  }

  if (scene === "break") {
    return `ここで感情をぶつけると、関係が一気に壊れます。
短く、責めずに、話す余地だけ残すのが大事です。`;
  }

  if (scene === "like") {
    return `ストレートに好意を出すと重くなることがあります。
“話していて楽しい”くらいが、一番自然に距離を縮めます。`;
  }

  return `この一言で印象が変わります。
普通に返すだけで終わるか、次につながるかの差が出ます。`;
}

function getPaidHook(scene) {
  if (scene === "explain") {
    return `・もっと自然な受け止め方
・相手がまた返しやすい言い方
・距離を縮める一言`;
  }

  if (scene === "ignore") {
    return `・重く見えない追い方
・返事が来やすい一言
・送るタイミング`;
  }

  if (scene === "cold") {
    return `・温度を戻す言い方
・距離を詰めすぎない一言
・相手の本音の見方`;
  }

  if (scene === "break") {
    return `・今送るべきか
・追うべきか待つべきか
・関係を壊さない一言`;
  }

  if (scene === "like") {
    return `・好意が自然に伝わる言い方
・相手が意識しやすい一言
・距離を縮める返し`;
  }

  return `・もっと自然な言い方
・相手が返しやすい言い方
・距離を縮める言い方`;
}

function formatFreeOutput({ decision, reply, scene, style }) {
  return `【結論】
👉 ${decision.conclusion}

【返信】
👉 ${reply}

💡ここで差が出ます
👉 ${getFreeTip({ decision, scene })}

【今の返信タイプ】
👉 ${getStyleLabel(style)}

──
この返信でも大きく外しません。
でも、相手の温度を上げたいなら👇

${getPaidHook(scene)}

はプレミアムで見れます。`;
}

function formatPremiumOutput({ decision, replies, scene }) {
  return `【結論】
👉 ${decision.conclusion}

【理由】
${decision.reason}

【おすすめ返信】
① ${replies[0]}
→ 自然で安全

② ${replies[1]}
→ 相手が返しやすい

③ ${replies[2]}
→ 少し距離を縮める

【送るタイミング】
${decision.sendTiming}

──
💡どれを送るのが一番いいか、
相手の反応まで読むならPROがおすすめです。`;
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

  const decision = decisionEngine({
    scene,
    risk,
    action,
    plan: safePlan
  });

  if (!decision || !decision.conclusion) {
    throw new Error("decisionEngine returned invalid result");
  }

  if (safePlan === "free" && user.usageCount >= 3) {
    return `無料診断は3回までです。

ここから先は👇
・返信パターン
・送るタイミング
・関係の進め方

をプレミアムで確認できます。`;
  }

  if (safePlan === "free") {
    const baseReply = getOneReply(scene, "free");
    const style = pickStyle({ scene, input });
    const reply = composeReply(baseReply, style);

    updateUser(userId, {
      usageCount: user.usageCount + 1,
      scene,
      risk,
      action,
      plan: safePlan
    });

    return formatFreeOutput({
      decision,
      reply,
      scene,
      style
    });
  }

  if (safePlan === "premium") {
    const replies = getReplyTemplates(scene, "premium").slice(0, 3);

    updateUser(userId, {
      scene,
      risk,
      action,
      plan: safePlan
    });

    return formatPremiumOutput({
      decision,
      replies,
      scene
    });
  }

  if (safePlan === "pro") {
    const replies = getReplyTemplates(scene, "pro").slice(0, 3);

    updateUser(userId, {
      scene,
      risk,
      action,
      plan: safePlan
    });

    return formatProOutput({
      decision,
      replies
    });
  }

  throw new Error("Unknown plan");
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

      if (event.type === "follow") {
        await replyMessage(replyToken, welcomeMessage());
        continue;
      }

      if (event.type === "message" && event.message?.type === "text") {
        const userId = event.source?.userId || "unknown_user";
        const text = trimText(event.message.text);

        let result;

        if (!text || isGreeting(text)) {
          result = welcomeMessage();
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
