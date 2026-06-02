const axios = require("axios");

function safeParseJson(text = "") {
  try {
    const cleaned = String(text || "")
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    return JSON.parse(cleaned);
  } catch (err) {
    return null;
  }
}

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
必ずJSONだけを返してください。説明文は禁止です。

目的：
LINEスクショから直近の会話を読み取り、次にユーザーが送ると自然な一言を提案します。

LINEスクショの読み方：
・基本的に左側の吹き出し = 相手
・右側の吹き出し = ユーザー
・直近の5〜10通を中心に見る
・長い履歴を全部まとめようとしない
・読めない部分は無理に補完しない
・スタンプだけの場合は「内容不明」と扱う
・最後の相手の発言、または会話の最後の流れを重視する

返すJSON形式：
{
  "success": true,
  "chatContext": "相手：...\\n私：...\\n相手：...",
  "reply": "ユーザーに返す文章"
}

replyのルール：
・日本語のみ
・中国語禁止
・恋愛相談の長文分析をしない
・まず次に送る一言を出す
・送るLINEは必ず「」で囲む
・「」の中に絵文字は入れない
・説明は1〜2文だけ
・見出し禁止
・箇条書き禁止
・相手の気持ちは断定しない
・でも、次にどう返すのが自然かは判断する

スクショが読めない場合：
{
  "success": false,
  "chatContext": "",
  "reply": "画像の内容をうまく読み取れませんでした。相手から来たLINEか、直近のやり取りをテキストで送ってください。"
}
`
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "このLINEスクショを読んで、直近の会話内容と、次に送るなら自然な一言をJSONで返してください。"
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
        temperature: 0.35,
        max_tokens: 700
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const text = res.data.choices[0].message.content.trim();
    const parsed = safeParseJson(text);

    if (!parsed) {
      return {
        success: false,
        chatContext: "",
        reply: "画像の内容をうまく読み取れませんでした。相手から来たLINEか、直近のやり取りをテキストで送ってください。"
      };
    }

    return {
      success: Boolean(parsed.success),
      chatContext: cleanText(parsed.chatContext || ""),
      reply: cleanText(parsed.reply || "")
    };
  } catch (err) {
    console.error("IMAGE ANALYZER ERROR:", err.response?.data || err.message);

    return {
      success: false,
      chatContext: "",
      reply: "画像の内容をうまく読み取れませんでした。相手から来たLINEか、直近のやり取りをテキストで送ってください。"
    };
  }
}

module.exports = {
  analyzeLineScreenshot
};
