const axios = require("axios");

async function updateConversationSummary({
  previousSummary = "",
  input = "",
  reply = "",
  scenario = "normal"
}) {
  try {
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: `
あなたは恋愛LINE相談の会話要約AIです。
ユーザーには見せない内部メモを作ってください。

ルール：
・日本語のみ
・1〜2文で短く
・事実ベース
・断定しすぎない
・不安を煽らない
・ユーザーの状況、目的、注意点を簡潔に残す
・返信文そのものは長く引用しない
`
          },
          {
            role: "user",
            content: `
前回までの要約：
${previousSummary || "なし"}

今回のユーザー入力：
${input}

今回のAI返信：
${reply}

シナリオ：
${scenario}

上記を踏まえて、次回以降の相談に役立つ内部要約を更新してください。
`
          }
        ],
        temperature: 0.2,
        max_tokens: 180
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
    console.error("SUMMARY ERROR:", err.response?.data || err.message);
    return previousSummary || "";
  }
}

module.exports = { updateConversationSummary };
