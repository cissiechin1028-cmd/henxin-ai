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

最重要ルール：
・日本語のみ
・1〜2文で短く
・事実ベース
・ユーザーが明確に言った内容だけを残す
・AI返信内の推測を事実として要約しない
・断定しすぎない
・不安を煽らない
・返信文そのものは長く引用しない

禁止：
・「裏切り」「冷めた」「脈なし」「浮気」「嫌われた」「終わり」などを、ユーザーが明確に言っていない限り書かない
・相手の気持ちを断定しない
・原因を勝手に決めつけない
・AI返信の推測を会話の事実として保存しない

残すべき内容：
・ユーザーが言った事実
・ユーザーの感情
・ユーザーの目的
・次回相談時に必要な注意点

書き方：
・「ユーザーは〜と言っている」
・「ユーザーは〜を不安に感じている」
・「〜の可能性があるため、断定せず扱う」
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
ただし、AI返信内の推測や解釈は事実として保存しないでください。
`
          }
        ],
        temperature: 0.1,
        max_tokens: 160
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
