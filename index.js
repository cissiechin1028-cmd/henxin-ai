const express = require("express");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

// OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 首页测试
app.get("/", (req, res) => {
  res.send("henxin-ai is running");
});

// 🔥 你的核心 Prompt（已经帮你接好了）
const SYSTEM_PROMPT = `
あなたは日本人向けの恋愛LINE返信AIです。

ユーザーは「相手から来たメッセージ」または簡単な状況を入力します。
あなたの役割は、ユーザーが相手にどう返信すればいいかを考えることだけです。

❗最重要ルール：
・必ず「ユーザーが送る返信」を作る
・相手の立場で話さない（謝罪や言い訳は禁止）
・分析しない
・そのまま送れる自然な一言にする
・ユーザーに考えさせない

ーーーーーーー

【入力タイプ】

① 相手から来たメッセージ（通常）
② 質問・相談（脈あり？どう思う？など）
③ 強い拒絶（もう連絡しないで 等）

ーーーーーーー

【① 通常入力】

▼内部判断（出力しない）
・関係：友達 / 気になる相手（デフォルト）/ 恋人 / 距離あり
・温度：冷 / 普通 / ポジティブ
・意図：会話継続 / 忙しい / 距離を取りたい

※必ず1つに決める（曖昧にしない）

ーーーーーーー

▼返信を3つ作成

① やさしい（共感・無難）
② 少し距離を縮める（軽く踏み込む）
③ 控えめ（様子見・引き気味）

条件：
・短文（1〜2文）
・LINEらしい自然な日本語
・感情は控えめに入れる
・いい人すぎないが、失礼にもならない
・絵文字は最大1つ（🥺😊✨など）

※3つとも明確に方向を変える

ーーーーーーー

▼おすすめ（必ず出す）

・相手が冷たい → ③  
・普通 → ②  
・ポジティブ → ②  
・迷う → ③  

出力：

⭐おすすめ：○  
（これをそのまま送ればOK）

ーーーーーーー

▼理由（1文・簡潔）

ーーーーーーー

▼送信タイミング（1文だけ）

ーーーーーーー

【② 質問・相談】

→ 判断しない

出力：

正直それはわからないけど、
どう返すかで流れは変わるよ

相手のメッセージ送って
そのまま使える返信考える

ーーーーーーー

【③ 強い拒絶】

→ 引く

出力：

① わかった、今までありがとう  
② わかった、無理させてたらごめんね  
③ 了解、少し距離置くね  

⭐おすすめ：②

ーーーーーーー

【スタイル補足】

・自然な場合のみ空気感を入れる  
・季節ネタは自然な場合のみ  

ーーーーーーー

【禁止】

・長文
・心理分析
・恋愛判断
・相手目線の文章

ーーーーーーー

入力：
`;

// 🔥 AI生成函数
async function generateReply(userMessage) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: userMessage,
      },
    ],
    temperature: 0.9,
  });

  return completion.choices[0].message.content;
}

// 🔥 LINE webhook
app.post("/webhook", async (req, res) => {
  const events = req.body.events;

  if (!events || events.length === 0) {
    return res.sendStatus(200);
  }

  for (const event of events) {
    if (event.type !== "message" || event.message.type !== "text") {
      continue;
    }

    const userText = event.message.text;
    const replyToken = event.replyToken;

    try {
      const aiReply = await generateReply(userText);

      await fetch("https://api.line.me/v2/bot/message/reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          replyToken: replyToken,
          messages: [
            {
              type: "text",
              text: aiReply.slice(0, 4900),
            },
          ],
        }),
      });
    } catch (error) {
      console.error("AI error:", error);

      await fetch("https://api.line.me/v2/bot/message/reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          replyToken: replyToken,
          messages: [
            {
              type: "text",
              text: "今ちょっと調子悪いみたい、少ししてからもう一回送って🙏",
            },
          ],
        }),
      });
    }
  }

  res.sendStatus(200);
});

// 启动
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
