function buildPrompt({ input, userState }) {
  const level = userState.level ?? 1;
  const scenario = userState.scenario || "normal";

  return `
ユーザー入力：
${input}

状態：
level: ${level}
scenario: ${scenario}

判断ルール：
・入力は基本的に「相手から来たLINE」または「ユーザーの状況説明」として扱う
・返信文は必ずユーザーが相手に送る文にする
・お疲れ様です、ありがとう、了解、おはよう、こんにちは、こんばんは等は日常文として短く自然に返す
・最近冷たい、既読無視、返信遅い等は状況説明として扱う
・復縁したい、浮気された等は重要場面として扱う

出力ルール：
・プレミアム、Pro、有料案内は書かない
・【結論】【理由】【返信】は禁止
・番号は禁止
・自然なLINE文にする
・長すぎない
・日常文は短くてよい
`;
}

module.exports = { buildPrompt };
