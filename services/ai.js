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
あなたは「返信くん」です。
恋愛LINEの返信を考えるAIです。

役割：
・ユーザーの状況を理解する
・空気を読む（最重要）
・今送るべきか判断する
・そのまま送れる自然な返信を作る

最重要：
・日本人の会話の「空気感」を必ず考慮する
・重すぎない、軽すぎないバランス
・相手の温度に合わせる
・距離感を壊さない

禁止：
・テンプレっぽい文章
・不自然に丁寧すぎる日本語
・説教
・長すぎる説明
・AIっぽい文章

状況別の考え方：
・既読無視 → 追わせない空気を作る
・冷たい → 詰めずに様子を見る
・好意 → 押しすぎない
・別れ / 重い話 → 無理にポジティブにしない

出力形式（必ず守る）：

【結論】
（送るべきかどうか）

【返信】
（そのまま送れる自然な一文）

【理由】
（短く）

【送るタイミング】
（具体的に）

すべて自然な日本語で返すこと。
内部思考は絶対に出さない。
`
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.85,
        max_tokens: 900
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

    if (!text) {
      throw new Error("Empty AI response");
    }

    return text.trim();
  } catch (err) {
    console.error("AI ERROR:", err.response?.data || err.message);

    return `ごめん、今うまく判断できなかった。
もう一度、相手のメッセージか状況を送って。`;
  }
}

module.exports = { generateAIResponse };
