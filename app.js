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

  return (
    t.includes("こんにちは") ||
    t.includes("こんばんは") ||
    t.includes("おはよう") ||
    t.includes("hi") ||
    t.includes("hello") ||
    t.includes("hey") ||
    t.includes("はじめまして")
  );
}

function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

//
// ✅ 智能问候
//
function greetingReply(text = "") {
  const t = normalize(text);

  let greeting = "こんにちは";

  if (t.includes("おはよう")) greeting = "おはよう";
  else if (t.includes("こんばんは")) greeting = "こんばんは";

  return `${greeting}😊

相手とのやり取り、そのまま送ってもらえれば一緒に見ます。

コピペでもいいし、
最近ちょっと冷たいかも…みたいな感じでも大丈夫です。`;
}

//
// ✅ 欢迎
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

function freeLimitMessage() {
  return `無料診断は3回までです。

ここから先はプレミアムで確認できます。

もう少し深く見たい場合は、
プレミアムに進んでください。`;
}

function imageReply() {
  return `スクショありがとう😊

今は画像の中身を直接読む準備中です。

相手のメッセージを文字で送ってもらえれば、
すぐ一緒に考えます。`;
}

//
// 🔥 软转化钩子（核心修复）
//
function premiumHook() {
  const hooks = [
    `——
ここ、ちょっと判断が分かれるところです。

返し方次第で、
距離が近づくこともあれば、そのまま離れることもあります。

もう少し細かく見るなら、プレミアムで確認できます。`,

    `——
今のままでも悪くはないですが、
少しズレると温度差が広がることがあります。

相手の感じ方まで見るなら、
プレミアムで確認できます。`,

    `——
この場面は、
「何を送るか」よりも距離感の取り方が大事です。

ここを外すと流れが変わりやすいので、
もう少し詳しくはプレミアムで見れます。`,

    `——
一見シンプルですが、
ここでの一言で印象が結構変わります。

どう受け取られるかまで見るなら、
プレミアムで確認できます。`,

    `——
今はまだ大きく崩れていませんが、
ここでの動き方で今後が変わりやすいです。

もう一歩踏み込んで見るなら、
プレミアムで確認できます。`
  ];

  return pickOne(hooks);
}

//
// 🔥 免费裁剪
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

    if (result.length >= 6) break;
  }

  return result.join("\n") + `

${premiumHook()}`;
}

async function handleTextMessage(userId, text) {
  const input = trimText(text);
  const user = getUser(userId);

  if (!input) return greetingReply(input);
  if (isGreeting(input)) return greetingReply(input);

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
