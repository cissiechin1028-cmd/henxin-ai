const express = require("express");

const { replyMessage } = require("./services/line");
const { generateAIResponse } = require("./services/ai");
const { getUser, updateUser } = require("./userStore");

const app = express();
app.use(express.json());

function trimText(text = "", max = 1200) {
  return String(text || "").slice(0, max).trim();
}

function normalize(text = "") {
  return String(text || "")
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
    "hello",
    "hey",
    "はじめまして"
  ].includes(t);
}

function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

//
// ✅ 已优化 welcome（加好友）
//
function welcomeMessage() {
  return `はじめまして、返信くんです😊

相手から来たLINEをそのまま送ってください。

うまく返せないときや、
ちょっと距離を感じるときも大丈夫です。

今送っていいかも含めて、
自然な返信を一緒に考えます。

まずは3回まで無料で使えます。`;
}

//
// ✅ 已优化 greeting（打招呼）
//
function greetingReply() {
  return `こんにちは😊

相手とのやり取り、そのまま送ってもらえれば一緒に見ます。

コピペでもいいし、
最近ちょっと冷たいかも…みたいな感じでも大丈夫です。`;
}

function freeLimitMessage() {
  return `無料診断は3回までです。

ここから先はプレミアムで確認できます👇

・相手の本音の見方
・一番自然な返信
・送るタイミング
・関係を壊さない次の一手

今の状況をもう少し深く見たい場合は、
プレミアムに進んでください。`;
}

function imageReply() {
  return `スクショありがとう😊

今は画像の中身を直接読む準備中です。

相手のメッセージを文字でそのまま送ってくれたら、
すぐ返信を作れます。`;
}

//
// 🔥 付费钩子（随机）
//
function premiumHook() {
  const hooks = [
    `——
ここで少し返し方を変えるだけで、
相手の反応は結構変わります。

この先👇
・一番自然な言い方
・相手がどう受け取るか
・今動くべきか

はプレミアムで見れます。`,

    `——
このままでも大きく外しませんが、
少しズレると距離が広がる可能性もあります。

この先👇
・相手の本音の見方
・避けた方がいい一言
・一番いいタイミング

はプレミアムで見れます。`,

    `——
ここはちょっとだけ空気を読むと、
印象がかなり変わるポイントです。

この先👇
・相手が返しやすい言い方
・重くならない距離感
・次につながる一言

はプレミアムで見れます。`
  ];

  return pickOne(hooks);
}

//
// 🔥 免费裁剪（关键）
//
function trimFreeOutput(text = "") {
  const clean = String(text || "").trim();

  if (!clean) {
    return `少し様子を見ながら、
軽く返すのが良さそうです。

👇 送るならこれで大丈夫
「無理しないでね。また話せるときに話そ😊」

${premiumHook()}`;
  }

  const lines = clean
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const result = [];

  for (const line of lines) {
    result.push(line);

    if (
      line.includes("」") ||
      line.includes("送るなら") ||
      line.includes("これで大丈夫")
    ) {
      break;
    }

    if (result.length >= 6) {
      break;
    }
  }

  return result.join("\n") + `

${premiumHook()}`;
}

async function handleTextMessage(userId, text) {
  const input = trimText(text);
  const user = getUser(userId);

  if (!input) return greetingReply();
  if (isGreeting(input)) return greetingReply();

  const plan = user.plan || "free";
  const usageCount = user.usageCount || 0;

  if (plan === "free" && usageCount >= 3) {
    return freeLimitMessage();
  }

  const aiResult = await generateAIResponse({
    input,
    userState: { ...user, plan, usageCount }
  });

  let result = aiResult;

  if (plan === "free") {
    result = trimFreeOutput(aiResult);
  }

  if (plan === "free") {
    updateUser(userId, {
      usageCount: usageCount + 1,
      plan
    });
  }

  return result;
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

      if (event.type === "message") {
        const userId = event.source?.userId || "unknown_user";

        if (event.message?.type === "text") {
          const result = await handleTextMessage(userId, event.message.text);
          await replyMessage(replyToken, result);
          continue;
        }

        if (event.message?.type === "image") {
          await replyMessage(replyToken, imageReply());
          continue;
        }

        await replyMessage(
          replyToken,
          "テキストで送ってもらえれば対応できます😊"
        );
      }
    } catch (err) {
      console.error("WEBHOOK ERROR:", err);

      try {
        if (event.replyToken) {
          await replyMessage(
            event.replyToken,
            "ごめん、もう一度送ってみて🙏"
          );
        }
      } catch {}
    }
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
