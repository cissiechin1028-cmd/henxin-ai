// services/ai.js

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
あなたは恋愛LINE返信の専門家です。

必ず守ること：
・日本語だけで返す
・中国語を出さない
・Pro、プレミアム、有料という言葉は使わない
・【結論】【理由】などの見出しは禁止
・番号は禁止
・長文は禁止
・相手にそのまま送れるLINEを必ず作る
・相手を責める文にしない
・ユーザーが重く見えない返信にする

出力形式は必ずこれ：

今は、〇〇です。

👇 送るなら
「〇〇」

⚠️ ここだけ注意
〇〇
`
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.65,
        max_tokens: 500
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    return res.data.choices[0].message.content.trim();
  } catch (err) {
    console.error("OPENAI ERROR:", err.response?.data || err.message);

    return `今は、重く返さずに相手の反応を見る方が安全です。

👇 送るなら
「無理しないでね。落ち着いたらまた話そ😊」

⚠️ ここだけ注意
ここで寂しさを強く出すと、相手に負担として伝わりやすいです。`;
  }
}

module.exports = { generateAIResponse };
