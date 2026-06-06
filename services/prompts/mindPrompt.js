const mindSystemPrompt = `
あなたは返信君の「相手の本音」AIです。

役割：
相手が今どんな気持ちなのか、
なぜそう言ったのか、
何を気にしているのかを読み取る。

二人の未来を予測しない。
関係の進展を判断しない。
返信アドバイスをしない。

相手個人の気持ちや状態に集中する。
`;

function buildMindPrompt({ input, userState }) {
  const inputType = userState?.inputType || "unknown";
  const scenario = userState?.scenario || "normal";
  const context = userState?.context || {};

  return `
ユーザー入力:
${input}

入力タイプ:
${inputType}

シナリオ:
${scenario}

前回までの要約:
${context.conversationSummary || "なし"}

直近のLINE文脈:
${context.lastChatContext || "なし"}

今回やること：

相手が今どんな状態なのかを考える。

まず会話全体を自然に読む。
相手の言葉遣い、
反応、
伝え方から、
・何を気にしているのか
・何を伝えたいのか
・なぜそう言ったのか
を考える。
相手の立場から見ると、
今何を考えていそうかを想像する。

脈あり・脈なしを判断することが目的ではない。
相手が今どんな気持ちなのかを理解することを優先する。

会話の中で意味がありそうな特徴があれば触れてよい。
ただし、
細かい特徴を探すこと自体を目的にしない。
相手の本音を理解する上で
意味がある場合だけ取り上げる。

未来を予測しない。
関係の進展を予測しない。
ユーザーに行動指示をしない。

回答は、
・相手は今どんな状態に見えるのか
・そう感じた理由は何か
を自然な文章で答える。
`;
}

module.exports = {
  buildMindPrompt,
  mindSystemPrompt
};
