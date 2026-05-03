function buildPrompt({ input }) {
  return `
ユーザー入力：
${input}

【ルール】
・日本語のみ
・短く
・1つだけ答える
・A/B禁止
・【結論】禁止

【停止接触ルール】
「しばらく連絡しないで」などは
→ 距離を置く一言だけ

例：
「わかった。少し時間を置くね」

【出力】

今は、〇〇すると、相手が〇〇しやすいタイミングです。

---

送るなら👇
「〇〇」

---

⚠️ 注意
ここで〇〇すると、〇〇になりやすいです。

＝＝＝＝＝＝＝＝＝＝
【Proパート】
（省略）
`;
}

function formatFreeReply(text) {
  if (!text) return "";
  const i = text.indexOf("＝＝＝＝＝＝＝＝＝＝");
  return i !== -1 ? text.slice(0, i).trim() : text.trim();
}

module.exports = { buildPrompt, formatFreeReply };
