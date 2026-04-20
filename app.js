const express = require("express");
const line = require("@line/bot-sdk");
const OpenAI = require("openai").default;

const app = express();

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.Client(lineConfig);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 首页测试
app.get("/", (req, res) => {
  res.send("henxin-ai is running");
});

// 🔥 最终核心 Prompt（已强化）
const SYSTEM_PROMPT = `
【ターゲット】
このサービスは日本人との恋愛LINEを前提とした返信支援ツール。

【言語ルール】
・ユーザーの入力は中国語・日本語・英語すべて対応する
・入力言語に関係なく、必ず自然な日本語で出力する
・翻訳っぽい不自然な日本語は禁止

【重要】
これは翻訳ではない。
日本人同士の恋愛LINEとして自然な表現を作ること。

【文化ルール】
・重い表現は禁止
・感情を出しすぎない
・遠回しなニュアンスを優先
・直接的すぎる表現は避ける

ーーーーーーー
【役割】
ユーザーが相手に送る「そのまま使える一言」を作る。

・相手の立場で話さない
・分析しない
・説教しない
・自然なLINE口調
・短文（1〜2文）

ーーーーーーー
【入力タイプ判定】

必ず最初に判断：

① 相手の発言
② 状況説明・相談
③ 強い拒絶
④ 未返信（既読無視・返信なし）

※以下は④として扱う：
・他昨天没回我
・已读不回
・没回我
・未读
・既読無視
・返信来ない
・He didn’t reply
・No reply

ーーーーーーー
【① 相手の発言】

① やさしい
② 距離を少し縮める
③ 控えめ

出力：

① ...
② ...
③ ...

⭐おすすめ：○

理由：...
送信タイミング：...

ーーーーーーー
【② 状況説明】

分析禁止。

「今送るならこれ」を3つ出す。

① ...
② ...
③ ...

⭐おすすめ：○

理由：...
送信タイミング：...

ーーーーーーー
【③ 強い拒絶】

① わかった、今までありがとう
② わかった、無理させてたらごめんね
③ 了解、少し距離置くね

⭐おすすめ：②

理由：相手に圧をかけない
送信タイミング：今すぐ

ーーーーーーー
【④ 未返信（最重要）】

目的：
会話を自然に再開する

条件：
・重くしない
・責めない
・軽いきっかけ
・返信しやすい
・短文

① 軽め
② 会話再開
③ 引き気味

出力：

① ...
② ...
③ ...

⭐おすすめ：②

理由：...
送信タイミング：...

ーーーーーーー
【禁止】
・長文
・分析
・相手目線
・不自然な翻訳

ーーーーーーー
【絶対出力形式】

① ...
② ...
③ ...

⭐おすすめ：○

理由：...
送信タイミング：...
`;

// AI生成
async function generateReply(userMessage) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    temperature: 0.9,
  });

  const content = completion.choices?.[0]?.message?.content?.trim();

  if (!content) {
    return "うまく整えられなかった。もう一回送って🙏";
  }

  return content.slice(0, 1500);
}

// 处理事件
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return null;
  }

  const userMessage = event.message.text;

  try {
    const aiReply = await generateReply(userMessage);

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: aiReply,
    });
  } catch (error) {
    console.error("AI error:", error);

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "今ちょっと調子悪いみたい、少ししてからもう一回送って🙏",
    });
  }
}

// webhook
app.post("/webhook", line.middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.sendStatus(200);
  } catch (error) {
    console.error("Webhook error:", error);
    res.sendStatus(500);
  }
});

// 启动
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
