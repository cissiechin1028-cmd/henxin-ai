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

// 只把“纯入口闲聊”当短输入
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

function buildShortInputPrompt(userMessage, type) {
  if (type === "greeting") {
    return `
あなたは恋愛LINE返信サポートAIです。

挨拶に自然に返しつつ、
「相手とのやり取りを送れば返事を考えられる」ことを
会話の流れを壊さない範囲で軽く伝えてください。

条件：
・1〜2文
・自然
・営業っぽくしない
・軽く導線を出すだけ
・ユーザー本人と雑談しない

入力：
${userMessage}

出力：
返信文1つだけ
`;
  }

  if (type === "thanks") {
    return `
感謝への自然な一言返信を作る。

条件：
・1〜2文
・自然
・重くしない

入力：
${userMessage}

出力：
返信文1つ
`;
  }

  if (type === "sorry") {
    return `
謝罪への自然な受け止め返信を作る。

条件：
・1〜2文
・自然
・責めない

入力：
${userMessage}

出力：
返信文1つ
`;
  }

  if (type === "reaction") {
    return `
短い相づちへの自然な返しを作る。

条件：
・1〜2文
・自然
・広げすぎない

入力：
${userMessage}

出力：
返信文1つ
`;
  }

  return `
自然な返信文を1つ作ってください。

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

      // 测试用解锁
      if (userMessage === "解锁") {
        setPaid(userId, true);
        await replyMessage(
          event.replyToken,
          "プレミアムプランが有効になりました（無制限利用可能）"
        );
        continue;
      }

      // 风格切换（测试用）
      if (userMessage === "温和") {
        user.style = "soft";
        await replyMessage(
          event.replyToken,
          "スタイル：やさしめに設定しました"
        );
        continue;
      }

      if (userMessage === "正常") {
        user.style = "balance";
        await replyMessage(
          event.replyToken,
          "スタイル：標準に設定しました"
        );
        continue;
      }

      if (userMessage === "主动") {
        user.style = "push";
        await replyMessage(
          event.replyToken,
          "スタイル：少し積極的に設定しました"
        );
        continue;
      }

      addHistory(userId, `ユーザー: ${userMessage}`);
      const history = getHistory(userId);

      const shortType = classifyShortInput(userMessage);

      let prompt = "";
      if (shortType) {
        prompt = buildShortInputPrompt(userMessage, shortType);
      } else {
        prompt = buildPrompt({
          relationship: user.relationship,
          purpose: user.purpose,
          history,
          userMessage,
          style: user.style,
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
