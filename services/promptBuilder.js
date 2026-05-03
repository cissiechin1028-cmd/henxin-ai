function buildPrompt({ input, userState }) {
  const inputType = userState?.inputType || "unknown";
  const scenario = userState?.scenario || "normal";

  return `
ユーザー入力：
${input}

入力タイプ：
${inputType}

シナリオ：
${scenario}

【最重要ルール】
・日本語のみ
・短く
・1つだけ答える
・A/B禁止
・【結論】禁止
・質問で返すのは禁止
・ユーザーに考えさせるのは禁止
・説明させるのは禁止
・疑問文（？）で終わる返信は禁止
・そのまま送れるLINEを1つだけ出す

【入力タイプ別ルール】

■ partner
・ユーザー入力は相手から来たLINE
・そのまま返せる返信を作る
・相手を責めない
・重くしない

■ situation
・ユーザー入力は状況説明
・そのまま返すのは禁止
・必ず「相手に送れるLINE」に変換する
・質問で返すのは禁止

■ followup
・前回の流れを前提にする
・追加質問ではなく次に送る一言を出す

【停止接触ルール】
「しばらく連絡しないで」
「連絡しないで」
「距離置きたい」
などは、距離を置く一言だけにする。

例：
「わかった。少し時間を置くね」

【出力形式】

今は、〇〇すると、相手が〇〇しやすいタイミングです。

---

送るなら👇
「〇〇」

---

⚠️ 注意
ここで〇〇すると、〇〇になりやすいです。
`;
}

function formatFreeReply(text = "") {
  return String(text)
    .replace(/【結論】/g, "")
    .replace(/A（安全）/g, "")
    .replace(/B（少し攻める）/g, "")
    .replace(/A案/g, "")
    .replace(/B案/g, "")
    .trim();
}

module.exports = {
  buildPrompt,
  formatFreeReply
};
