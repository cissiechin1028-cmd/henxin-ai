const axios = require("axios");

function cleanText(text = "") {
  return String(text || "")
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function analyzeLineScreenshot(imageBuffer) {
  try {
    const base64Image = Buffer.from(imageBuffer).toString("base64");

    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: `
あなたはLINEスクショを読むAIです。

目的：
画像からLINEの会話内容を読み取り、
次にユーザーが送ると自然な返信文を1つ提案してください。

最重要：
・日本語のみ
・中国語禁止
・恋愛相談の長文分析をしない
・スクショ内の会話だけを見て判断する
・相手の気持ちは断定しない
・でも、会話の流れから次に送る一言は判断する
・送るLINEは必ず「」で囲む
・「」の中に絵文字は入れない
・説明は短く
・見出し禁止
・箇条書き禁止

LINEスクショの読み方：
・基本的に左側の吹き出し = 相手
・右側の吹き出し = ユーザー
・読めない部分は無理に補完しない
・スタンプだけの場合は内容不明として扱う
・最後の相手の発言、または会話の最後の流れを重視する

出力：
1〜3段落で自然に返す。
まず次に送る一言を出す。
そのあと、なぜそれが自然かを1〜2文で短く添える。

例：
「お疲れさま。今日はゆっくり休んでね」

今は無理に話を広げるより、相手が返しやすい軽さで返す方が自然です。
`
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "このLINEスクショを読んで、次に送るならどんな一言が自然か教えてください。"
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`
                }
              }
            ]
          }
        ],
        temperature: 0.45,
        max_tokens: 600
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    return cleanText(res.data.choices[0].message.content.trim());
  } catch (err) {
    console.error("IMAGE ANALYZER ERROR:", err.response?.data || err.message);

    return `画像の内容をうまく読み取れませんでした。

相手から来たLINEか、直近のやり取りをテキストで送ってください。`;
  }
}

module.exports = {
  analyzeLineScreenshot
};
