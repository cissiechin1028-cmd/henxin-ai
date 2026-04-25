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

function classifyGreeting(text) {
  const s = (text || "").trim();

  const greetings = [
    "おはよう",
    "おはよ",
    "こんにちは",
    "こんばんは",
    "お疲れ様",
    "お疲れ様です",
  ];

  return greetings.includes(s);
}

function detectUserStyle(userMessage) {
  const text = userMessage || "";

  if (/既読無視|未読|返事来ない|冷たい|そっけない|無視/.test(text)) {
    return "soft";
  }

  if (/不安|怖い|迷って|送っていい|重いかな|大丈夫かな/.test(text)) {
    return "soft";
  }

  if (/会いたい|誘いたい|ご飯行きたい|進めたい/.test(text)) {
    return "push";
  }

  return "balance";
}

// ✅ 新增：复合识别
function detectReconciliation(userMessage) {
  const text = userMessage || "";
  return /復縁|元カレ|元カノ|やり直したい|振られた|別れた|もう一度|取り戻したい/.test(text);
}

function buildGreetingPrompt(userMessage) {
  return `
あなたは恋愛LINE返信サポートAIです。

ユーザーの挨拶に自然に返しつつ、
「相手とのLINE内容」または「今の状況」を送れば返信を一緒に考えられることを伝えてください。

条件：
・1〜2文
・自然
・営業っぽくしない
・①②③を出さない
・おすすめ、理由、送信タイミングを出さない
・返信文1つだけ

入力：
${userMessage}

出力：
`;
}

app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events || [];

    for (const event of events) {

      // ✅ 欢迎语（最终版）
      if (event.type === "follow") {
        await replyMessage(event.replyToken, `そのLINE、このまま送ると失敗するかも。

ちょっとした一言で、
距離が一気にズレることもある。

ここで👇
✔ 今送るべきか判断
✔ 一番安全な返しを作る

やることは1つだけ👇
相手のメッセージ、そのまま送って

（コピペ・スクショOK）

そのまま送れる形で出すから、
考えなくて大丈夫。`);
        continue;
      }

      if (event.type !== "message") continue;
      if (event.message.type !== "text") continue;

      const userId = event.source.userId;
      const userMessage = event.message.text.trim();
      const user = getUser(userId);

      const isReconciliation = detectReconciliation(userMessage);

      // ✅ 复合场景：免费用户降级
      if (isReconciliation && !user.isPaid) {
        const reply = `この状況は少し慎重に見た方がいいです。

一言で印象が大きく変わる可能性があります。

【今の一番安全な返し】
「久しぶりだね、元気にしてる？」

──────────

このケースは通常のLINE返信よりも、
タイミングや言い方で結果が大きく変わる可能性があります。

一度の判断ミスで、
関係が戻らなくなるケースもあります。

より精度の高い判断（送るべきか・タイミング・戦略）は
プレミアムで対応しています。`;

        await replyMessage(event.replyToken, reply);
        continue;
      }

      if (userMessage === "解锁") {
        setPaid(userId, true);
        await replyMessage(event.replyToken, "プレミアムプランが有効になりました");
        continue;
      }

      let prompt = "";
      let final = "";

      if (classifyGreeting(userMessage)) {
        prompt = buildGreetingPrompt(userMessage);
        const raw = await generateReply(prompt);
        final = raw.trim();
      } else {
        addHistory(userId, `ユーザー: ${userMessage}`);
        const history = getHistory(userId);
        const style = detectUserStyle(userMessage);

        prompt = buildPrompt({
          relationship: user.relationship,
          purpose: user.purpose,
          history,
          userMessage,
          style,
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
