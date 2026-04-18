const express = require("express");
const OpenAI = require("openai");

const app = express();

app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 首页测试
app.get("/", (req, res) => {
  res.send("henxin-ai is running");
});

// 生成恋爱回复
async function generateReply(userMessage) {
  const prompt = `
你是一个日本市场的「恋愛返信AI」。
用户会发来一句话，代表“对方说的话”或者“自己想回的话题”。

你的任务：
1. 给出 3 个适合直接发送的日语回复
2. 风格自然、像真人聊天，不要太生硬
3. 语气温柔、恋爱感、不过度油腻
4. 最后给一个“おすすめ”编号
5. 输出必须简洁、好复制

输出格式固定如下：

その返信、このまま送って大丈夫？

送ってくれた内容に合わせて、
ちょうどいい返しを3パターン考えるよ👇

① ...
② ...
③ ...

⭐おすすめ：...
（そのまま送ってOK）

用户内容：
${userMessage}
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content: "あなたは自然で上手な恋愛メッセージ返信アシスタントです。",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.9,
  });

  return completion.choices[0].message.content;
}

// LINE webhook
app.post("/webhook", async (req, res) => {
  console.log("Webhook received:", JSON.stringify(req.body, null, 2));

  const events = req.body.events;

  if (!events || events.length === 0) {
    return res.sendStatus(200);
  }

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userText = event.message.text;
      const replyToken = event.replyToken;

      try {
        const aiReply = await generateReply(userText);

        await fetch("https://api.line.me/v2/bot/message/reply", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
          },
          body: JSON.stringify({
            replyToken,
            messages: [
              {
                type: "text",
                text: aiReply.slice(0, 4900),
              },
            ],
          }),
        });
      } catch (error) {
        console.error("AI reply error:", error);

        await fetch("https://api.line.me/v2/bot/message/reply", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.jf1Uibgf3Xt2W6/EgxBwnrpzLfIggus0Sq3HLhPTH+tdrkJSuBXdpIOnNk/Eb6lo0wLUj0rlrRMqcSqay35dNlBQmHdA/KsDZIBB74kDUakrEcQ/0XkFXQ3mjYDfYyfNNWBMEJUJjaoIcO8pz4TydQdB04t89/1O/w1cDnyilFU=}`,
          },
          body: JSON.stringify({
            replyToken,
            messages: [
              {
                type: "text",
                text: "ごめんね、今ちょっと混み合ってるみたい。少ししてからもう一度送ってね🙏",
              },
            ],
          }),
        });
      }
    }
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
