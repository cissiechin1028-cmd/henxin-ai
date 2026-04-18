const express = require("express");
const app = express();

app.use(express.json());

// 首页
app.get("/", (req, res) => {
  res.send("henxin-ai is running");
});

// LINE webhook
app.post("/webhook", async (req, res) => {
  const events = req.body.events;

  if (!events) {
    return res.sendStatus(200);
  }

  for (let event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const replyToken = event.replyToken;

      await fetch("https://api.line.me/v2/bot/message/reply", {
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
              text: "收到啦～❤️",
            },
          ],
        }),
      });
    }
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
