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

// ===== 短输入 Prompt（🔥已强化引导）=====
function buildShortInputPrompt(userMessage, type) {
  if (type === "greeting") {
    return `
あなたは日本人向けの恋愛返信代写AIです。

以下は挨拶メッセージです。
自然に返しつつ、「次にユーザーが何を送ればいいか」を明確に伝えてください。

目的：
ユーザーを「相手のメッセージ or 状況入力」に誘導する

条件：
・1〜2文
・自然
・やわらかい
・営業っぽくしない
・押しつけない
・最後に必ず導線を入れる

入力：
${userMessage}

出力例：
・おはよう。もし返事に迷ってるLINEがあったら、そのまま送ってくれたら一緒に考えるよ。
・お疲れ様、無理しすぎないでね。相手のメッセージを送ってくれたら、そのまま使える返事を考えられるよ。

出力：
返信文のみ
`;
  }

  if (type === "thanks") {
    return `
感謝メッセージへの自然な返信を1つ作る。
軽く受けつつ、「返信相談できる」ことを自然に伝える。

入力：
${userMessage}

出力：
返信文のみ
`;
  }

  if (type === "sorry") {
    return `
謝罪メッセージへの自然な返信を1つ作る。
責めずに受け止めつつ、軽く安心させる。

入力：
${userMessage}

出力：
返信文のみ
`;
  }

  if (type === "reaction") {
    return `
短い相づちへの自然な返信を1つ作る。
軽く会話が続く形にする。

入力：
${userMessage}

出力：
返信文のみ
`;
  }

  if (type === "question") {
    return `
短い疑問・催促に対して自然な返信を1つ作る。
圧を強くしない。

入力：
${userMessage}

出力：
返信文のみ
`;
  }

  return `
短いメッセージに対して自然な返信を1つ作る。

入力：
${userMessage}

出力：
返信文のみ
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

      // 👉 测试期间建议先关闭（你可以以后再打开）
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

      // 👉 手动解锁测试
      if (userMessage === "解锁") {
        setPaid(userId, true);
        await replyMessage(
          event.replyToken,
          "プレミアムプランが有効になりました（無制限利用可能）"
        );
        continue;
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
