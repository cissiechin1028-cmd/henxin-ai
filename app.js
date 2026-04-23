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

// ===== 测试白名单 =====
const TEST_USER_IDS = (process.env.TEST_USER_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function isTestUser(userId) {
  return TEST_USER_IDS.includes(userId);
}

// ===== 短输入分类 =====
function classifyShortInput(text) {
  const s = (text || "").trim();

  if (["おはよう", "こんにちは", "こんばんは", "お疲れ様", "お疲れ様です"].includes(s)) return "greeting";
  if (["ありがとう", "ありがと", "助かる"].includes(s)) return "thanks";
  if (["ごめん", "ごめんね", "すみません"].includes(s)) return "sorry";
  if (["うん", "そうだね", "了解", "OK", "ok", "笑", "w"].includes(s)) return "reaction";
  if (["？", "?", "返事まだ？"].includes(s)) return "question";

  if (s.length <= 8) return "reaction";

  return null;
}

// ===== 短输入 Prompt =====
function buildShortInputPrompt(userMessage, type) {
  if (type === "greeting") {
    return `
あなたは日本人向けの恋愛返信代写AIです。

以下は挨拶メッセージです。
自然に返しつつ、会話の流れを壊さない範囲で、
「返信を一緒に考えられる」ことをさりげなく伝えてください。

条件：
・1〜2文
・自然
・やわらかい
・営業っぽくしない
・押しつけない
・あくまで会話の延長

入力：
${userMessage}

出力：
返信文のみを1つ
`;
  }

  if (type === "thanks") {
    return `
感謝メッセージへの自然な返信を1つ作る。
軽く受けつつ、必要ならやさしく会話をつなぐ。

入力：
${userMessage}

出力：
返信文のみを1つ
`;
  }

  if (type === "sorry") {
    return `
謝罪メッセージへの自然な返信を1つ作る。
責めずに受け止める。

入力：
${userMessage}

出力：
返信文のみを1つ
`;
  }

  if (type === "reaction") {
    return `
短い相づちへの自然な返信を1つ作る。
軽く会話が続く形にする。

入力：
${userMessage}

出力：
返信文のみを1つ
`;
  }

  if (type === "question") {
    return `
短い疑問・催促に対して自然な返信を1つ作る。
圧を強くしない。

入力：
${userMessage}

出力：
返信文のみを1つ
`;
  }

  return `
短いメッセージに対して自然な返信を1つ作る。

入力：
${userMessage}

出力：
返信文のみを1つ
`;
}

// ===== webhook =====
app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events || [];

    for (const event of events) {
      if (event.type !== "message") continue;
      if (event.message.type !== "text") continue;

      const userId = event.source.userId;
      const userMessage = event.message.text.trim();

      const user = getUser(userId);
      const isTest = isTestUser(userId);

      // ===== 免费限制 =====
      if (!isTest && !user.isPaid && getFreeCount(userId) >= 3) {
        await replyMessage(
          event.replyToken,
          "本日の無料回数（3回）が終了しました。\nプレミアムで無制限に使えます。"
        );
        continue;
      }

      if (!isTest) {
        increaseFreeCount(userId);
      }

      addHistory(userId, `ユーザー: ${userMessage}`);
      const history = getHistory(userId);

      let prompt = "";
      const shortType = classifyShortInput(userMessage);

      if (shortType) {
        prompt = buildShortInputPrompt(userMessage, shortType);
      } else {
        prompt = buildPrompt({
          relationship: user.relationship,
          purpose: user.purpose,
          history,
          userMessage,
        });
      }

      const raw = await generateReply(prompt);
      const final = postprocessReply(raw, userMessage, history);

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
