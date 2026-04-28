const axios = require("axios");
const { buildPrompt } = require("./promptBuilder");

async function generateAIResponse({ input, userState }) {
  const prompt = buildPrompt({ input, userState });

  try {
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: `
あなたは恋愛LINE返信の専門家。

絶対ルール：
・プレミアム / Pro / 有料は書かない
・【結論】【理由】など禁止
・番号禁止
・長文説明禁止
・必ず「相手に送るLINE」を作る

出力形式：

今は〇〇です。

👇 送るなら
「〇〇」

⚠️ ここだけ注意
〇〇（リスク）
`
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 600
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        }
      }
    );

    return res.data.choices[0].message.content.trim();
  } catch {
    return `今は軽く返すのが自然です。

👇 送るなら
「無理しないでね😊」

⚠️ ここだけ注意
優しすぎると後回しにされることがあります。`;
  }
}

module.exports = { generateAIResponse };
