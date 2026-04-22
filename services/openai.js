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
            content: "恋愛返信AI。必ず自然な日本語で出力する",
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
        timeout: 15000, // 15秒超时
      }
    );

    const text = res.data?.choices?.[0]?.message?.content;

    if (!text) {
      throw new Error("Empty AI response");
    }

    return text;
  } catch (err) {
    console.error("OpenAI ERROR:", err.response?.data || err.message);

    // ===== 降级兜底（绝对不能让系统挂）=====
    return `① ちょっとバタバタしてた、ごめんね！元気してる？  
② 最近どうしてる？ふと思い出して連絡しちゃった  
③ なんか急に話したくなった笑 元気？

⭐おすすめ：②  
理由：自然で圧がない  
送信タイミング：今すぐ`;
  }
}

module.exports = { generateReply };
