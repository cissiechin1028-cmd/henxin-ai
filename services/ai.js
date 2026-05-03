const axios = require("axios");
const { buildPrompt, formatFreeReply } = require("./promptBuilder");

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

ルール：
・日本語のみ
・中国語は禁止
・Pro、プレミアム、有料、課金という言葉は禁止
・長文禁止
・一般論禁止
・説教禁止
・自然な日本語
・判断を必ず入れる
・優しいだけの回答は禁止
・テンプレートの使い回しは禁止

重要：
・ユーザープロンプトの出力形式を最優先する
・入力タイプに従う
・相手を責めない
・追いすぎない
・卑屈にならない
・でも避雷点ははっきり言う
`
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.65,
        max_tokens: 800
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const aiResponse = res.data.choices[0].message.content.trim();

    return formatFreeReply(aiResponse);
  } catch (err) {
    console.error("OPENAI ERROR:", err.response?.data || err.message);

    return `【結論】
今は、無理に踏み込むと相手がさらに距離を置きやすい状態です。

---

送るなら👇

A（安全）
「無理しないでね。落ち着いたらまた話そう」

B（少し攻める）
「今は無理に聞かないけど、落ち着いたら少しだけ話せたら嬉しい」

---

⚠️ 注意
ここで理由を聞いたり追いかけると、相手がさらに離れやすいです。`;
  }
}

module.exports = { generateAIResponse };
