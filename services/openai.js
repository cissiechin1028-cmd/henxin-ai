const axios = require("axios");

async function generateReply(prompt) {
  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: "恋愛返信AI。必ず日本語で出力" },
        { role: "user", content: prompt },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );

  return res.data.choices[0].message.content;
}

module.exports = { generateReply };
