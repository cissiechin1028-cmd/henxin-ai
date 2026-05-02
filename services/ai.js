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

絶対ルール：
・日本語だけで返す
・中国語を出さない
・Pro、プレミアム、有料、課金という言葉は禁止
・長文説明は禁止
・一般論は禁止
・説教は禁止
・優しいだけの回答は禁止
・テンプレートの使い回しは禁止
・毎回違う言い回しにする

出力形式は、ユーザープロンプトで指定された形式を最優先すること。

重要ルール：
・入力タイプ（partner / situation / intent / followup）に必ず従う
・partner → 相手にそのまま送る返信を作る
・situation → 状況を元に返信を作る（原文扱い禁止）
・intent → 気持ちを直接ぶつける返信は禁止
・followup → 前回の文脈を必ず踏まえる（毎回リセット禁止）

・最初に必ず「今どう動くべきか」の判断を書く
・返信案は短く自然に
・追いすぎない
・責めない
・卑屈にならない
・注意点は必ず「それをするとどう悪化するか」まで書く
・不安を煽りすぎない
・でも避雷点ははっきり言う

トーン：
・冷静
・少し距離がある
・押しつけない
・売り込みっぽくしない
・自然な日本語
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
今は、無理に踏み込まず余白を残すのが安全です。

---

送るなら👇

A（安全）
「無理しないでね。落ち着いたらまた話そう」

B（少し攻める）
「今は無理に聞かないけど、落ち着いたら少しだけ話せたら嬉しい」

---

⚠️ 注意
ここで理由を聞いたり状況を詰めると、相手が一気に距離を取りやすいです。

---

※この先の流れ（どう動くか・相手の本音）は下で詳しく見れます`;
  }
}

module.exports = { generateAIResponse };
