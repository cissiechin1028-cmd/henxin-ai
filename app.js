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
    t.includes("hi") ||
    t.includes("hello") ||
    t.includes("hey") ||
    t.includes("はじめまして")
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
  if (isGreeting(input) || /テスト|なんでもない/.test(String(input || ""))) return 0;

  return 1;
}

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
    return `ここから先は、動き方でかなり変わる場面です。

復縁は「何を送るか」より、
今が冷却期なのか、再接触していい時期なのかの判断が大事です。

この先の流れはProで確認できます。`;
  }

  if (scenario === "cheating") {
    return `ここは感情だけで動くと、
相手の本音が見えなくなることがあります。

今は「問い詰めるか」より、
どう動けば自分が不利にならないかが大事です。

この先の判断はProで確認できます。`;
  }

  return `ここから先は、もう少し深く見た方がいい場面です。

返し方ひとつで、
距離が縮まるか、そのまま離れるかが変わることがあります。

この先はプレミアムで確認できます。`;
}

function trialHook(usageCount, level, scenario) {
  if (usageCount === 0) return "";

  if (usageCount === 1) {
    return `

——
ここは少しだけ空気を読むと、
返したあとの印象が変わりやすい場面です。`;
  }

  if (usageCount === 2) {
    if (level === 3) {
      if (scenario === "reunion") {
        return `

——
ここからの動き方で、
「戻る流れ」と「終わる流れ」が分かれやすいです。

復縁の進め方はProで詳しく見れます。`;
      }

      if (scenario === "cheating") {
        return `

——
ここで感情のまま動くと、
相手が防御に入って本音が見えにくくなることがあります。

出方の見極めはProで詳しく見れます。`;
      }

      return `

——
ここからの動き方で、
結果が大きく変わる場面です。

この先はProで詳しく見れます。`;
    }

    if (level === 2) {
      return `

——
ここで少しズレると、
距離がそのまま広がる流れになることもあります。

この先はプレミアムで見れます。`;
    }

    return `

——
このままでも大きく外しませんが、
少し整えると印象が変わる可能性があります。

この先はプレミアムで見れます。`;
  }

  return "";
}

function cleanLine(line = "") {
  return String(line || "")
    .trim()
    .replace(/^①\s*/, "")
    .replace(/^②\s*/, "")
    .replace(/^③\s*/, "")
    .replace(/^④\s*/, "")
    .replace(/^⑤\s*/, "")
    .replace(/^1\.\s*/, "")
    .replace(/^2\.\s*/, "")
    .replace(/^3\.\s*/, "")
    .replace(/^4\.\s*/, "")
    .replace(/^5\.\s*/, "");
}

function trimFreeOutput(text = "", usageCount = 0, level = 1, scenario = "normal") {
  const clean = String(text || "").trim();

  if (!clean) {
    return `少し様子を見ながら、
軽く返すのが良さそうです。

👇 送るなら
「無理しないでね。また話せるときに話そ😊」${trialHook(
      usageCount,
      level,
      scenario
    )}`;
  }

  const lines = clean
    .split("\n")
    .map((line) => cleanLine(line))
    .filter(Boolean);

  const result = [];
  let sawReplyTitle = false;
  let sawReplyText = false;

  for (const line of lines) {
    result.push(line);

    if (
      line.includes("👇") ||
      line.includes("送るなら") ||
      line.includes("返信")
    ) {
      sawReplyTitle = true;
      continue;
    }

    if (sawReplyTitle && line.includes("」")) {
      sawReplyText = true;
      break;
    }

    if (!sawReplyTitle && line.includes("」")) {
      sawReplyText = true;
      break;
    }

    if (result.length >= 9) {
      break;
    }
  }

  if (!sawReplyText) {
    result.push("「無理しないでね。また落ち着いたら話そう😊」");
  }

  return result.join("\n") + trialHook(usageCount, level, scenario);
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
    result = trimFreeOutput(aiResult, usageCount, level, scenario);
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
