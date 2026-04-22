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
            content: "出力は必ず自然な日本語。文脈不足なら無理に返信案を作らず確認を優先する。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.7,
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
