// app.js

const express = require("express");

const detectScene = require("./utils/detectScene");
const detectRisk = require("./utils/detectRisk");
const { detectUserAction } = require("./utils/detectUserAction");
const decisionEngine = require("./utils/decisionEngine");

const { getOneReply, getReplyTemplates } = require("./replyTemplates");
const { getUser, updateUser } = require("./userStore");
const { replyMessage } = require("./services/line");

const { pickStyle, getStyleLabel } = require("./styleEngine");
const composeReply = require("./replyComposer");

const app = express();
app.use(express.json());

function normalize(text = "") {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[！!？?。．、,.〜~\s]/g, "");
}

function isGreeting(text = "") {
  const t = normalize(text);
  return [
    "こんにちは",
    "こんばんは",
    "おはよう",
    "おはようございます",
    "hi",
    "hello"
  ].includes(t);
}

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

  return `こんにちは😊
何か話したいことや、相手とのやりとりがあれば教えてね。
一緒に考えるよ。`;
}

function welcomeMessage() {
  return `そのLINE、このまま送ると危ないかも。

👇やることはこれだけ
相手のメッセージ、そのまま送って

（コピペ・スクショOK）

そのまま送れる返信、作る。`;
}

function decideMode({ scene, action }) {
  if (scene === "ignore" && action !== "sent") return "judge";
  if (scene === "cold" && action !== "sent") return "judge";
  if (scene === "break" && action !== "sent") return "judge";
  return "reply";
}

// ⭐⭐⭐ 这里只改这个 ⭐⭐⭐
function formatDecisionOnlyOutput({ scene }) {
  if (scene === "ignore") {
    return `【結論】
👉 今はまだ送らない方が安全です。

既読無視の状態で追うと、
一気に「重い」と感じられやすいです。

💡ここがポイント
👉 返さなくてもいい空気を出すと、
相手の方から戻ってきやすくなります。

今は👇
・追わない
・少し時間を空ける
・相手の負担を減らす

これが一番安全です。

──
このあと👇
・いつ送るべきか
・送るなら何て送るか
・相手の心理

はプレミアムで見れます。`;
  }

  if (scene === "cold") {
    return `【結論】
👉 今は様子を見るのが安全です。

ここで踏み込むと、
さらに距離が開く可能性があります。

💡ここで差が出ます
👉 不安をぶつけると逆効果
👉 軽く様子を見る方が関係は戻りやすいです

今は👇
・無理に詰めない
・会話を軽く保つ

が安全です。

──
・距離を縮める一言
・自然な戻し方

はプレミアムで見れます。`;
  }

  if (scene === "break") {
    return `【結論】
👉 今は追いかけない方が安全です。

この状態で強く出ると、
一気に関係が崩れる可能性があります。

💡重要
👉 今は“止める”ことが一番の戦略です

──
・復縁できる動き方
・送るべきタイミング

はプレミアムで見れます。`;
  }

  if (scene === "like") {
    return `【結論】
👉 今は少し様子を見ながら進めるのが安全です。

💡ここがポイント
👉 「楽しい」「また話したい」くらいが自然です

──
・距離を縮める一言
・好意の出し方

はプレミアムで見れます。`;
  }

  if (scene === "explain") {
    return `【結論】
👉 今は受け止めるのが安全です。

💡ここがポイント
👉 「忙しい中でも返してくれたこと」に触れると印象UP

──
・印象を上げる一言
・関係を進める返し方

はプレミアムで見れます。`;
  }

  return `【結論】
👉 今は無理に動かない方が安全です。`;
}

function formatFreeOutput({ decision, reply, scene, style }) {
  return `【結論】
👉 ${decision.conclusion}

【返信】
👉 ${reply}

💡ここで差が出ます
👉 この一言で印象が変わります

【今の返信タイプ】
👉 ${getStyleLabel(style)}

──
この返信でもOKですが👇
・もっと自然な言い方
・返しやすい一言
・距離を縮める言い方

はプレミアムで見れます。`;
}

function handleLogic(userId, input, plan = "free") {
  const user = getUser(userId);

  const scene = detectScene(input);
  const risk = detectRisk({ text: input, scene });
  const action = detectUserAction(input);
  const mode = decideMode({ scene, action });

  if (plan === "free" && mode === "judge") {
    return formatDecisionOnlyOutput({ scene });
  }

  const decision = decisionEngine({
    scene,
    risk,
    action,
    plan
  });

  const baseReply = getOneReply(scene, "free");
  const style = pickStyle({ scene, input });
  const reply = composeReply(baseReply, style);

  return formatFreeOutput({
    decision,
    reply,
    scene,
    style
  });
}

// ===== webhook =====

app.post("/webhook", async (req, res) => {
  const events = req.body.events || [];

  for (const event of events) {
    const replyToken = event.replyToken;

    if (event.type === "follow") {
      await replyMessage(replyToken, welcomeMessage());
      continue;
    }

    if (event.type === "message") {
      const userId = event.source.userId;
      const text = event.message.text;

      let result;

      if (isGreeting(text)) {
        result = greetingReply(text);
      } else {
        result = handleLogic(userId, text, "free");
      }

      await replyMessage(replyToken, result);
    }
  }

  res.sendStatus(200);
});

app.listen(3000, () => {
  console.log("Server running");
});
