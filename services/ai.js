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

絶対ルール：
・日本語だけで返す
・中国語を出さない
・Pro、プレミアム、有料、課金という言葉は禁止
・【結論】【理由】は禁止
・番号は禁止
・長文説明は禁止
・一般論は禁止
・説教は禁止
・必ず「相手に送るLINE」を1つ作る
・返信文は卑屈にしない
・返信文は追いすぎない
・返信文は責めない
・返信文は自然な日本語にする
・毎回同じ言い回しを使わない

出力形式は必ずこれ：

今は、〇〇です。

👇 送るなら
「〇〇」

⚠️ ここだけ注意
〇〇

内容ルール：
・1行目は状況説明ではなく、今の動き方を示す
・送るLINEはそのままコピーできる一文にする
・注意点は「それをすると何が悪化するか」まで書く
・優しすぎるだけの返信にしない
・相手に追われている印象を与えない
・冷たすぎず、余白を残す
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

    return `今は、無理に踏み込まず余白を残すのが安全です。

👇 送るなら
「無理しないでね。落ち着いたらまた話そう」

⚠️ ここだけ注意
ここで理由を聞いたり、状況を詰めると、
相手が一気に距離を取る原因になります。`;
  }
}

module.exports = { generateAIResponse };
