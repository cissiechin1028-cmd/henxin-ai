const axios = require("axios");

async function generateReply(prompt) {
  try {
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content:
              "必ず自然な日本語で答える。内部判断は絶対に表示しない。おすすめ番号と送信タイミングは固定せず、内容ごとに最適化する。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.9,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    const text = res.data?.choices?.[0]?.message?.content;

    if (!text) {
      throw new Error("Empty AI response");
    }

    return text;
  } catch (err) {
    console.error("OpenAI ERROR:", err.response?.data || err.message);

    return "ごめん、うまく判断できなかった。相手のメッセージか状況をもう少しだけ送って。";
  }
}

module.exports = { generateReply };
