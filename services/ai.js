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

出力形式は必ずこれ：

今は、〇〇です。

👇 送るなら
「〇〇」

⚠️ ここだけ注意
〇〇

重要ルール：

・入力タイプ（partner / situation / intent / followup）に必ず従う
・partner → 相手にそのまま送る返信を作る
・situation → 状況を元に「軽い一文」を作る（原文扱い禁止）
・intent → 気持ちを直接ぶつける返信は禁止
・followup → 前回の文脈を必ず踏まえる（毎回リセット禁止）

・1行目は「今どう動くべきか」の判断を書く
・返信文は1つだけ
・短く自然に
・追いすぎない
・責めない
・卑屈にならない

・注意点は必ず「それをするとどう悪化するか」まで書く
・優しいだけの回答は禁止
・テンプレートの使い回しは禁止
・毎回違う言い回しにする

トーン：
・冷静
・少し距離がある
・押しつけない
・売り込みっぽくしない
・不安を煽りすぎない
・でも避雷点ははっきり言う
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
