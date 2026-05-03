const axios = require("axios");

async function generateProResponse(context) {
  const prompt = `
あなたは恋愛LINE戦略の専門家です。

ユーザーは無料回答の続き（より具体的な行動と本音）を求めています。

必ず以下の形式で出力してください：

【本音】
相手は今、〇〇の可能性が高く、
△△を避けるように動いている状態です。

【この後どうする？】
・今は〇〇しない
・〇〇のタイミングで軽く接触する
・△△にはまだ触れない

【送るなら】
「〇〇」

【言い換え】
「〇〇」
「〇〇」

【タイミング】
・今は送らない
・送るなら〇〇（時間帯）

【やりがちNG】
ここで〇〇すると、
相手が△△になり、本音を出さなくなります。

重要：
・無料内容の焼き直しは禁止
・必ず具体的にする
・抽象禁止
・長すぎないが情報は多く
`;

  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: "日本語のみで答える" },
        { role: "user", content: prompt }
      ],
      temperature: 0.7
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  return res.data.choices[0].message.content.trim();
}

module.exports = { generateProResponse };
