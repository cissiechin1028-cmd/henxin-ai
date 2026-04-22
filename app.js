require("dotenv").config();
const express = require("express");

const {
  getUser,
  addHistory,
  getHistory,
  increaseFreeCount,
  getFreeCount,
  setPaid,
} = require("./userStore");

const { generateReply } = require("./services/openai");
const { replyMessage } = require("./services/line");
const { buildPrompt } = require("./utils/prompt");
const { postprocessReply } = require("./utils/postprocess");

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

      // 临时付费测试
      if (userMessage === "解锁") {
        setPaid(userId, true);

        await replyMessage(
          event.replyToken,
          "プレミアムプランが有効になりました（無制限利用可能）"
        );
        continue;
      }

      // 免费次数限制
      if (!user.isPaid && getFreeCount(userId) >= 3) {
        await replyMessage(
          event.replyToken,
          "本日の無料回数（3回）が終了しました。\n明日また3回使えます。\nプレミアムプランなら無制限で利用できます。"
        );
        continue;
      }

      increaseFreeCount(userId);

      // 记录用户输入
      addHistory(userId, `ユーザー: ${userMessage}`);

      const history = getHistory(userId);

      // 构建 Prompt
      const prompt = buildPrompt({
        relationship: user.relationship,
        purpose: user.purpose,
        history,
        userMessage,
      });

      // 调用 AI
      const rawAiText = await generateReply(prompt);

      // 后处理：去掉内部判断 + 推荐保护 + 时机修正
      const aiText = postprocessReply(rawAiText, userMessage, history);

      // 记录 AI
      addHistory(userId, `AI: ${aiText}`);

      // 回复用户
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
