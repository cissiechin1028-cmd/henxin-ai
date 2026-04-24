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

  const greetings = [
    "おはよう",
    "おはよ",
    "こんにちは",
    "こんばんは",
    "お疲れ様",
    "お疲れ様です",
  ];

  if (greetings.includes(s)) return "greeting";

  return null;
}

function buildGreetingPrompt(userMessage, greetingCount) {
  if (greetingCount >= 2) {
    return `
あなたは恋愛LINE返信サポートAIです。

ユーザーが続けて挨拶だけを送っています。
自然に返しつつ、次に何を送ればいいかをはっきり伝えてください。

条件：
・1〜2文
・自然
・営業っぽくしない
・①②③を出さない
・おすすめ、理由、送信タイミングを出さない
・「相手のLINE内容」または「今の状況」を送るように案内する

入力：
${userMessage}

出力：
返信文1つ
`;
  }

  return `
あなたは恋愛LINE返信サポートAIです。

ユーザーの挨拶に自然に返しつつ、
「相手とのLINE内容や状況を送れば返信を一緒に考えられる」ことを伝えてください。

条件：
・1〜2文
・自然
・営業っぽくしない
・①②③を出さない
・おすすめ、理由、送信タイミングを出さない

入力：
${userMessage}

出力：
返信文1つ
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

      const shortType = classifyShortInput(userMessage);

      let prompt = "";
      let final = "";

      if (shortType === "greeting") {
        user.greetingCount = (user.greetingCount || 0) + 1;

        prompt = buildGreetingPrompt(userMessage, user.greetingCount);

        const raw = await generateReply(prompt);
        final = raw.trim();
      } else {
        user.greetingCount = 0;

        addHistory(userId, `ユーザー: ${userMessage}`);
        const history = getHistory(userId);

        prompt = buildPrompt({
          relationship: user.relationship,
          purpose: user.purpose,
          history,
          userMessage,
        });

        const raw = await generateReply(prompt);
        final = postprocessReply(raw);

        addHistory(userId, `AI: ${final}`);
      }

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
