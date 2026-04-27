// app.js

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

function welcomeMessage() {
  return `はじめまして、返信くんです😊

相手から来たLINEをそのまま送ってください。

・返信に迷っている
・既読無視されている
・最近ちょっと冷たい
・何て返せばいいかわからない

そんな時に、
今送っていいかまで見て返信を作ります。

まずは3回まで無料で使えます。`;
}

function greetingReply() {
  return `こんにちは😊

相手とのLINEや、今の状況をそのまま送ってください。

例：
「最近返信が冷たい」
「既読無視されてる」
「この返事どう返せばいい？」
「相手から来た文面をコピペ」

そのまま送れる返信を作ります。`;
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

function premiumHook() {
  const hooks = [
    `——
ここで大事なのは、
「何を送るか」より“どの温度で送るか”です。

この先👇
・相手が今どう受け取りそうか
・一番自然な言い方
・送るタイミング

はプレミアムで見れます。`,

    `——
このまま返すだけでも大きく外しません。

ただ、少し言い方を変えるだけで、
「重い」ではなく「感じがいい」に変わります。

この先👇
・もっと自然な返信
・相手が返しやすい一言
・今送るべきか

はプレミアムで見れます。`,

    `——
ここで詰めすぎると、
相手の温度が下がることがあります。

でも、余白を残せば戻りやすいです。

この先👇
・距離を詰めすぎない言い方
・相手の本音の見方
・次に送るべき一言

はプレミアムで見れます。`,

    `——
今の状況は、
返し方を少し間違えると“追ってる感”が出やすいです。

この先👇
・重く見えない言い方
・相手が返したくなる余白
・一番いい送るタイミング

はプレミアムで見れます。`,

    `——
ここは雑に返すより、
少しだけ空気を読んだほうがいい場面です。

この先👇
・相手の温度に合う返信
・やめた方がいい一言
・次につながる返し方

はプレミアムで見れます。`
  ];

  return pickOne(hooks);
}

function trimFreeOutput(text = "") {
  const clean = String(text || "").trim();

  if (!clean) {
    return `少し状況を見ながら、重くなりすぎない返し方がよさそう。

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
      line.includes("返信するなら") ||
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

  if (!input) {
    return greetingReply();
  }

  if (isGreeting(input)) {
    return greetingReply();
  }

  const plan = user.plan || "free";
  const usageCount = user.usageCount || 0;

  if (plan === "free" && usageCount >= 3) {
    return freeLimitMessage();
  }

  const aiResult = await generateAIResponse({
    input,
    userState: {
      ...user,
      plan,
      usageCount
    }
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
          "今はテキストの相談に対応しています。相手のメッセージを文字で送ってください😊"
        );
      }
    } catch (err) {
      console.error("WEBHOOK ERROR:", err.stack || err.message || err);

      try {
        if (event.replyToken) {
          await replyMessage(
            event.replyToken,
            "ごめん、今うまく処理できなかった。もう一度送ってください。"
          );
        }
      } catch (replyErr) {
        console.error("ERROR REPLY FAILED:", replyErr.response?.data || replyErr.message);
      }
    }
  }

  return res.sendStatus(200);
});

app.post("/api/chat", async (req, res) => {
  try {
    const { userId = "test_user", message } = req.body;
    const result = await handleTextMessage(userId, message || "");

    return res.json({ message: result });
  } catch (err) {
    console.error("API ERROR:", err.stack || err.message || err);

    return res.status(200).json({
      message: "ごめん、今うまく判断できなかった。もう一度送ってください。"
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
