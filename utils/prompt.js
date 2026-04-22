function buildPrompt({ relationship, purpose, history, userMessage }) {
  return `
あなたは恋愛返信の専門AIです。

【関係】
${relationship || "不明"}

【目的】
${purpose || "不明"}

【会話履歴】
${history.join("\n")}

【最新メッセージ】
${userMessage}

以下の形式で出力：

①返信案A
②返信案B
③返信案C

★おすすめ：
理由：
送るタイミング：
`;
}

module.exports = { buildPrompt };
