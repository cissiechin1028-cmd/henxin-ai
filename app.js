require("dotenv").config();
const express = require("express");

const {
  getUser,
  addHistory,
  getHistory,
  setPaid,
} = require("./userStore");

const { generateReply } = require("./services/openai");
const { replyMessage } = require("./services/line");
const { buildPrompt } = require("./utils/prompt");
const { postprocessReply } = require("./utils/postprocess");

const app = express();
app.use(express.json());

function classifyShortInput(text) {
  const s = (text || "").trim();

  if (["おはよう", "おはよ", "こんにちは", "こんばんは"].includes(s)) {
    return "greeting";
  }

  if (["ありがとう", "ありがと", "ありがとうございます"].includes(s)) {
    return "thanks";
  }

  if (["ごめん", "ごめんね", "すみません"].includes(s)) {
    return "sorry";
  }

  if (["うん", "了解", "りょ", "OK", "ok", "笑", "w"].includes(s)) {
    return "reaction";
  }

  return null;
}

function buildShortInputPrompt(userMessage) {
  return `
あなたは恋愛LINE返信サポートAIです。

挨拶に自然に返しつつ、
「相手とのやり取りや状況を送れば返事を考えられる」ことを
軽く伝えてください。

条件：
・1〜2文
・自然
・営業っぽくしない
・ユーザー本人と雑談しない
・絵文字は最大1つまで

入力：
${userMessage}

出力：
返信文1つだけ
`;
}

app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events || [];

    for (const event of events) {
      if (event.type !== "message") continue;
      if (event.message.type !== "text") continue;

      const userId = event.source.userId;
      const userMessage = event.message.text.trim();
      const user = getUser(userId);

      if (userMessage === "解锁") {
        setPaid(userId, true);
        await replyMessage(
          event.replyToken,
          "プレミアムプランが有効になりました"
        );
        continue;
      }

      addHistory(userId, `ユーザー: ${userMessage}`);
      const history = getHistory(userId);

      const shortType = classifyShortInput(userMessage);

      let prompt = "";
      if (shortType) {
        prompt = buildShortInputPrompt(userMessage);
      } else {
        prompt = buildPrompt({
          relationship: user.relationship,
          purpose: user.purpose,
          history,
          userMessage,
        });
      }

      const raw = await generateReply(prompt);
      const final = postprocessReply(raw);

      addHistory(userId, `AI: ${final}`);
      await replyMessage(event.replyToken, final);
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
