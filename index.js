const express = require("express");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.get("/", (req, res) => {
  res.send("henxin-ai is running");
});

async function generateReply(userMessage) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `あなたは自然で上手な恋愛メッセージ返信アシスタントです。
必ず日本語で返してください。
ユーザーの内容に合わせて、短く自然な返信案を3つ出してください。`,
      },
      {
        role: "user",
        content: `相手から来た内容はこれです：${userMessage}

次の形式で返してください：

その返信、このまま送って大丈夫？

① ...
② ...
③ ...

⭐おすすめ：...
（そのまま送ってOK）`,
      },
    ],
    temperature: 0.9,
  });

  return completion.choices[0].message.content;
}

app.post("/webhook", async (req, res) => {
  console.log("Webhook received:", JSON.stringify(req.body, null, 2));

  const events = req.body.events;

  if (!events || events.length === 0) {
    return res.sendStatus(200);
  }

  for (const event of events) {
    if (event.type !== "message" || event.message.type !== "text") {
      continue;
    }

    const userText = event.message.text;
    const replyToken = event.replyToken;

    try {
      const aiReply = await generateReply(userText);

      console.log("AI reply generated successfully");

      const lineRes = await fetch("https://api.line.me/v2/bot/message/reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          replyToken: replyToken,
          messages: [
            {
              type: "text",
              text: aiReply.slice(0, 4900),
            },
          ],
        }),
      });

      const lineText = await lineRes.text();
      console.log("LINE reply status:", lineRes.status);
      console.log("LINE reply response:", lineText);
    } catch (error) {
      console.error("AI reply error message:", error?.message || error);
      console.error("AI reply error full:", error);

      const errorMessage = String(error?.message || error).slice(0, 200);

      const lineRes = await fetch("https://api.line.me/v2/bot/message/reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          replyToken: replyToken,
          messages: [
            {
              type: "text",
              text: `AI error: ${errorMessage}`,
            },
          ],
        }),
      });

      const lineText = await lineRes.text();
      console.log("Fallback LINE status:", lineRes.status);
      console.log("Fallback LINE response:", lineText);
    }
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
  console.log("OPENAI key exists:", !!process.env.OPENAI_API_KEY);
  console.log("LINE token exists:", !!process.env.LINE_CHANNEL_ACCESS_TOKEN);
});
