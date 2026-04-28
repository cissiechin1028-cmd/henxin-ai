function buildPrompt({ input, userState }) {
  const scenario = userState.scenario;

  return `
ユーザー入力：
${input}

シナリオ：
${scenario}

ルール：
・必ず「相手に送るLINE」を作る
・説明ではなく判断にする
・「〜するといい」禁止
・「今は〜が自然」形式
・注意点は必ずリスクにする

シナリオ別：

normal：
軽く整える

cold：
詰めると距離が広がる

ignore：
追うと逆効果

flirt：
重いと引かれる

reunion：
動き方で結果が変わる

cheating：
責めると本音が見えない
`;
}

module.exports = { buildPrompt };
