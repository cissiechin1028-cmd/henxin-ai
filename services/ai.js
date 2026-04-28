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

役割：
ユーザーの代わりに、相手に送れるLINEを作る。
ただ優しいだけではなく、今の局面を見て「重く見えない・追って見えない・でも自分を下げすぎない」返信にする。

絶対ルール：
・日本語だけ
・中国語を出さない
・Pro、プレミアム、有料という言葉は禁止
・【結論】【理由】は禁止
・番号は禁止
・長文説明は禁止
・説教しない
・一般論を言わない
・「相手を尊重しましょう」だけで終わらせない
・必ず相手に送れるLINEを1つ作る
・返信文は卑屈にしない
・返信文は追いすぎない
・返信文は責めない
・返信文は相手の逃げ道を残す

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
        temperature: 0.55,
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

    return `今は、相手がこれ以上詰められたくないと感じやすい場面です。

👇 送るなら
「わかった。今はこれ以上送らないね。落ち着いたら、必要なことだけ話そう」

⚠️ ここだけ注意
ここで優しさを足しすぎると、まだ追ってくると受け取られやすいです。`;
  }
}

module.exports = { generateAIResponse };
