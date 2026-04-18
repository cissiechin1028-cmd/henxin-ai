const express = require("express");
const app = express();

// 让服务器能解析 JSON（LINE 必须）
app.use(express.json());

// 首页（测试服务器是否活着）
app.get("/", (req, res) => {
  res.send("henxin-ai is running");
});

// LINE webhook
app.post("/webhook", async (req, res) => {
  console.log("Webhook received:", JSON.stringify(req.body, null, 2));

  const events = req.body.events;

  if (!events || events.length === 0) {
    return res.sendStatus(200);
  }

  const event = events[0];

  // 只处理用户发消息
  if (event.type === "message" && event.message.type === "text") {
    const replyToken = event.replyToken;

    try {
      await fetch("https://api.line.me/v2/bot/message/reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // 👇👇👇 这里替换成你的 token
          "Authorization": "Bearer jf1Uibgf3Xt2W6/EgxBwnrpzLfIggus0Sq3HLhPTH+tdrkJSuBXdpIOnNk/Eb6lo0wLUj0rlrRMqcSqay35dNlBQmHdA/KsDZIBB74kDUakrEcQ/0XkFXQ3mjYDfYyfNNWBMEJUJjaoIcO8pz4TydQdB04t89/1O/w1cDnyilFU=",
        },
        body: JSON.stringify({
          replyToken: replyToken,
          messages: [
            {
              type: "text",
              text: "收到啦～❤️",
            },
          ],
        }),
      });
    } catch (error) {
      console.error("Error sending message:", error);
    }
  }

  // 一定要返回 200，不然 LINE 会报错
  res.sendStatus(200);
});

// Render 用这个端口
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
