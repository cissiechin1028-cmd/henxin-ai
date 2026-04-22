require("dotenv").config();
const express = require("express");

const {
  getUser,
  addHistory,
  getHistory,
  increaseFreeCount,
  getFreeCount,
} = require("./userStore");

const { generateReply } = require("./services/openai");
const { replyMessage } = require("./services/line");
const { buildPrompt } = require("./utils/prompt");

const app = express();
app.use(express.json());

app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events || [];

    for (const event of events) {
      if (event.type !== "message") continue;
      if (event.message.type !== "text") continue;

      const userId = event.source.userId;
      const userMessage = event.message.text.trim();

      const user = getUser(userId);

      if (getFreeCount(userId) >= 3) {
        await replyMessage(
          event.replyToken,
          "無料回数が終了しました。続けるにはプランにご加入ください。"
        );
        continue;
      }

      increaseFreeCount(userId);

      addHistory(userId, `ユーザー: ${userMessage}`);

      const history = getHistory(userId);

      const prompt = buildPrompt({
        relationship: user.relationship,
        purpose: user.purpose,
        history,
        userMessage,
      });

      const aiText = await generateReply(prompt);

      addHistory(userId, `AI: ${aiText}`);

      await replyMessage(event.replyToken, aiText);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("ERROR:", err.response?.data || err.message);
    return res.sendStatus(500);
  }
});

app.get("/", (req, res) => {
  res.send("henxin-ai running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
