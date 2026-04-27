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

・もっと自然な返信
・送るタイミング
・相手の心理
・関係を壊さない返し方

プレミアムに進むと、返信の精度が上がります。`;
}

function imageReply() {
  return `スクショありがとう😊

今は画像の中身を直接読む準備中です。

相手のメッセージを文字でそのまま送ってくれたら、
すぐ返信を作れます。`;
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

  if (plan === "free") {
    updateUser(userId, {
      usageCount: usageCount + 1,
      plan
    });
  }

  return aiResult;
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
