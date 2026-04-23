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

// ===== 短输入分类：只处理明确的短句，不再按长度乱分 =====
function classifyShortInput(text) {
  const s = (text || "").trim();

  if (
    ["おはよう", "おはよ", "こんにちは", "こんばんは", "やっほー", "もしもし"].includes(s)
  ) {
    return "greeting";
  }

  if (["お疲れ様", "お疲れ様です"].includes(s)) {
    return "greeting";
  }

  if (["ありがとう", "ありがと", "ありがとうございます", "助かる", "助かります"].includes(s)) {
    return "thanks";
  }

  if (["ごめん", "ごめんね", "すみません", "申し訳ない", "申し訳ありません"].includes(s)) {
    return "sorry";
  }

  if (["うん", "ううん", "了解", "りょ", "OK", "ok", "笑", "w", "なるほど"].includes(s)) {
    return "reaction";
  }

  if (["？", "?", "何してる？", "返事まだ？"].includes(s)) {
    return "question";
  }

  return null;
}

// ===== 短输入 Prompt：只用于明确闲聊入口，不替代主功能 =====
function buildShortInputPrompt(userMessage, type) {
  if (type === "greeting") {
    return `
あなたは日本人向けの恋愛返信代写AIです。

以下は挨拶メッセージです。
自然に返しつつ、「相手のメッセージや状況を送れば返事を考えられる」と、
会話の流れを壊さない範囲で軽く伝えてください。

条件：
・1〜2文
・自然
・営業っぽくしない
・返信文そのものだけを出す
・ユーザー本人と雑談しない

入力：
${userMessage}

出力：
返信文のみを1つ
`;
  }

  if (type === "thanks") {
    return `
以下は感謝メッセージです。
自然な返信文を1つだけ作ってください。
必要なら軽く「返事に迷うLINEがあれば送って」と伝えてよいです。

入力：
${userMessage}

出力：
返信文のみを1つ
`;
  }

  if (type === "sorry") {
    return `
以下は謝罪メッセージです。
責めずに自然に受け止める返信文を1つだけ作ってください。

入力：
${userMessage}

出力：
返信文のみを1つ
`;
  }

  if (type === "reaction") {
    return `
以下は短い相づちです。
自然な返信文を1つだけ作ってください。
雑談を広げすぎないでください。

入力：
${userMessage}

出力：
返信文のみを1つ
`;
  }

  if (type === "question") {
    return `
以下は短い疑問・催促です。
圧を強くしない自然な返信文を1つだけ作ってください。

入力：
${userMessage}

出力：
返信文のみを1つ
`;
  }

  return `
以下のメッセージへの自然な返信文を1つだけ作ってください。

入力：
${userMessage}

出力：
返信文のみを1つ
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

      // 测试用手动解锁
      if (userMessage === "解锁") {
        setPaid(userId, true);
        await replyMessage(
          event.replyToken,
          "プレミアムプランが有効になりました（無制限利用可能）"
        );
        continue;
      }

      // 次数限制（要测试可先注释）
      /*
      if (!user.isPaid && getFreeCount(userId) >= 3) {
        await replyMessage(
          event.replyToken,
          "本日の無料回数（3回）が終了しました。\nプレミアムで無制限に使えます。"
        );
        continue;
      }
      increaseFreeCount(userId);
      */

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
