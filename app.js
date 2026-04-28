const express = require("express");

const { replyMessage } = require("./services/line");
const { generateAIResponse } = require("./services/ai");
const { generateProResponse } = require("./services/proEngine");
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
    t.includes("お疲れ様") ||
    t.includes("おつかれ") ||
    t.includes("hi") ||
    t.includes("hello") ||
    t.includes("hey") ||
    t.includes("はじめまして")
  );
}

function isLightMessage(text = "") {
  const t = normalize(text);

  return (
    t.includes("お疲れ様") ||
    t.includes("おつかれ") ||
    t.includes("ありがとう") ||
    t.includes("了解")
  );
}

function detectScenario(input = "") {
  const t = String(input || "");

  if (/浮気|不倫|裏切り|他の女|他の人|怪しい|浮気された|浮気してる/.test(t)) {
    return "cheating";
  }

  if (/復縁|別れた|元彼|元カノ|より戻したい|関係を戻したい/.test(t)) {
    return "reunion";
  }

  if (/既読無視|既読スルー|既読ついた|既読/.test(t)) {
    return "ignore";
  }

  if (/冷たい|そっけない|返信遅い|連絡減った|距離|温度差/.test(t)) {
    return "cold";
  }

  return "normal";
}

function detectLevel(input = "") {
  const scenario = detectScenario(input);

  if (scenario === "reunion" || scenario === "cheating") return 3;
  if (scenario === "ignore" || scenario === "cold") return 2;
  if (isGreeting(input) || isLightMessage(input)) return 0;

  return 1;
}

function greetingReply(text = "") {
  const t = normalize(text);

  if (t.includes("お疲れ様") || t.includes("おつかれ")) {
    return `お疲れ様です😊

相手とのやり取り、そのまま送ってもらえれば一緒に見ます。`;
  }

  let greeting = "こんにちは";
  if (t.includes("おはよう")) greeting = "おはよう";
  else if (t.includes("こんばんは")) greeting = "こんばんは";

  return `${greeting}😊

相手とのやり取り、そのまま送ってもらえれば一緒に見ます。

コピペでもいいし、
最近ちょっと冷たいかも…みたいな感じでも大丈夫です。`;
}

function welcomeMessage() {
  return `はじめまして、返信くんです😊

相手から来たLINEをそのまま送ってください。

うまく返せないときや、
ちょっと距離を感じるときも大丈夫です。

今送っていいかも含めて、
自然な返信を一緒に考えます。

まずは3回まで無料で使えます。`;
}

function imageReply() {
  return `スクショありがとう😊

今は画像の中身を直接読む準備中です。

相手のメッセージを文字で送ってもらえれば、
すぐ一緒に考えます。`;
}

function limitMessage(scenario) {
  if (scenario === "reunion") {
    return `ここから先は、返信よりも「動き方」の判断が大事な場面です。

焦って連絡すると戻る流れが崩れることもあります。

復縁の進め方はProで確認できます。`;
  }

  if (scenario === "cheating") {
    return `ここから先は、感情だけで動かない方がいい場面です。

問い詰めるか、少し引くかで相手の出方が変わります。

出方の見極めはProで確認できます。`;
  }

  return `ここから先は、もう少し言い方を整えた方がいい場面です。

相手が返しやすい自然な言い方は、
プレミアムで確認できます。`;
}

function extractCoreReply(text = "") {
  const clean = String(text || "").trim();

  if (!clean) {
    return {
      judge: "今は軽く返すのが自然です。",
      reply: "「無理しないでね。また落ち着いたら話そう😊」",
      caution: ""
    };
  }

  const lines = clean
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.includes("プレミアム") && !l.includes("Pro"));

  let judge = "";
  let reply = "";
  let caution = "";

  for (const line of lines) {
    if (!judge && !line.includes("👇") && !line.includes("⚠️") && !line.includes("「")) {
      judge = line;
    }

    if (!reply && line.includes("「") && line.includes("」")) {
      reply = line;
    }

    if (
      !caution &&
      !line.includes("👇") &&
      !line.includes("⚠️") &&
      !line.includes("「") &&
      judge &&
      line !== judge
    ) {
      caution = line;
    }
  }

  if (!judge) judge = "今は軽く返すのが自然です。";
  if (!reply) reply = "「無理しないでね。また落ち着いたら話そう😊」";

  return { judge, reply, caution };
}

function buildFreeMessage(aiText, usageCount, level, scenario) {
  const { judge, reply, caution } = extractCoreReply(aiText);

  if (usageCount === 0) {
    return `${judge}

👇 送るなら
${reply}`;
  }

  if (usageCount === 1) {
    const safeCaution =
      caution || "優しくしすぎると、相手に“後回しでも大丈夫”と思われることもあります。";

    return `${judge}

👇 送るなら
${reply}

⚠️ ここだけ注意
${safeCaution}`;
  }

  if (usageCount === 2) {
    const safeCaution =
      caution || "ここで少しズレると、距離がそのまま広がることもあります。";

    if (level === 3) {
      return `${judge}

👇 送るなら
${reply}

⚠️ ここだけ注意
${safeCaution}

ここから先は、返信より“動き方”の判断が大事です。
詳しく見るならProで確認できます。`;
    }

    return `${judge}

👇 送るなら
${reply}

⚠️ ここだけ注意
${safeCaution}

もう少し自然な言い方まで見るなら、
プレミアムで確認できます。`;
  }

  return `${judge}

👇 送るなら
${reply}`;
}

async function handleTextMessage(userId, text) {
  const input = trimText(text);
  const user = getUser(userId);

  if (!input) return greetingReply(input);
  if (isGreeting(input)) return greetingReply(input);

  const scenario = detectScenario(input);
  const level = detectLevel(input);

  const plan = user.plan || "free";
  const usageCount = user.usageCount || 0;

  if (plan === "pro") {
    return generateProResponse(input, scenario);
  }

  if (plan === "free" && usageCount >= 3) {
    return limitMessage(scenario);
  }

  const aiResult = await generateAIResponse({
    input,
    userState: {
      ...user,
      plan,
      usageCount,
      level,
      scenario
    }
  });

  let result = aiResult;

  if (plan === "free") {
    result = buildFreeMessage(aiResult, usageCount, level, scenario);
  }

  if (plan === "free") {
    updateUser(userId, {
      usageCount: usageCount + 1,
      plan,
      level,
      scenario
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

        await replyMessage(replyToken, "テキストで送ってもらえれば対応できます😊");
      }
    } catch (err) {
      console.error("WEBHOOK ERROR:", err);

      try {
        if (event.replyToken) {
          await replyMessage(event.replyToken, "ごめん、もう一度送ってみて🙏");
        }
      } catch {}
    }
  }

  res.sendStatus(200);
});

app.post("/api/chat", async (req, res) => {
  try {
    const { userId = "test_user", message } = req.body;
    const result = await handleTextMessage(userId, message || "");
    return res.json({ message: result });
  } catch (err) {
    console.error("API ERROR:", err);
    return res.status(200).json({
      message: "ごめん、もう一度送ってみて🙏"
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
