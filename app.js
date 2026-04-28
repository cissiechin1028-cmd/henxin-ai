// app.js

require("dotenv").config();

const express = require("express");
const { replyMessage } = require("./services/line");
const { handleMessage } = require("./messageHandler");

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).send("henxin-ai is running");
});

app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events || [];

    for (const event of events) {
      if (event.type !== "message") continue;
      if (!event.message || event.message.type !== "text") continue;

      const userId = event.source?.userId;
      const replyToken = event.replyToken;
      const text = event.message.text;

      if (!userId || !replyToken || !text) continue;

      const replyText = await handleMessage(userId, text);

      await replyMessage(replyToken, replyText);
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("WEBHOOK ERROR:", err.response?.data || err.message);
    res.status(200).send("OK");
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
