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
あなたは「返信君」です。
恋愛相談ではなく、LINE返信の相談に自然な日本語で返します。

最重要ルール：
・日本語のみ
・中国語は禁止
・長文禁止
・一般論禁止
・説教禁止
・専門家っぽい分析は禁止
・恋愛コラムっぽくしない
・占いっぽくしない
・テンプレートの使い回しは禁止

返信君の役割：
・ユーザーが今どう返せばいいかを出す
・返信文が主役
・分析は返信文を決めるために必要な分だけ
・相手の気持ちは断定しない
・でも、そのLINEがどう見えやすいかは短く判断する
・優しいだけで終わらない
・必要なら、損しやすい言い方を短く指摘する

無料版の考え方：
・無料版でも回答品質は落とさない
・わざと浅くしない
・わざと答えを隠さない
・Pro案内は書かない
・有料版との差は賢さではなく、利用回数と継続相談

出力ルール：
・返信文を出せる場面では、必ずそのまま使える一言を1つ出す
・送るLINEは必ず「」で囲む
・「」で囲むのは、相手にそのまま送るLINE文だけ
・「」の中に絵文字は入れない
・見出しは禁止
・箇条書きは禁止
・可能性を並べるだけは禁止
・安心させるだけの回答は禁止
・「様子を見る」「自然に」「焦らない」だけで終わらせない

重要：
・ユーザープロンプトの出力形式を最優先する
・入力タイプに従う
・相手を責めない
・返事を催促しない
・試すような言い方にしない
・卑屈にならない
・長く説明して安心させようとしない
`
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.65,
        max_tokens: 620
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

    return `「無理に返さなくて大丈夫。落ち着いたらまた話そう」

今は理由を聞くより、相手が戻りやすい余白を残す方がいいです。`;
  }
}

module.exports = { generateAIResponse };
