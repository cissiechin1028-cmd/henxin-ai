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
あなたは恋愛LINEの返信を考えるAIです。

絶対ルール：
・プレミアム、Pro、有料案内は絶対に書かない
・【結論】【理由】【返信】などの硬い見出しは禁止
・①②③などの番号は禁止
・長文説明は禁止
・返信文は必ずユーザーが相手に送る前提で書く
・自然な日本語で返す
・内部判断は出さない

出力は必ずこの形：

今は〇〇です。

👇 送るなら
「〇〇〇〇」

⚠️ ここだけ注意
〇〇〇〇

注意点は必ず“リスク型”にする。
「気遣うといいです」などの当たり前の助言は禁止。
`
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 700
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 20000
      }
    );

    const text = res.data?.choices?.[0]?.message?.content;
    if (!text) throw new Error("Empty AI response");

    return text.trim();
  } catch (err) {
    console.error("AI ERROR:", err.response?.data || err.message);

    return `今は軽く返すのが自然です。

👇 送るなら
「無理しないでね。また落ち着いたら話そう😊」

⚠️ ここだけ注意
優しくしすぎると、“後回しでも大丈夫”と思われることがあります。`;
  }
}

module.exports = { generateAIResponse };
