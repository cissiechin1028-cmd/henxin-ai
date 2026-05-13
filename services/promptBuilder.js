function buildPrompt({ input, userState }) {
  const inputType = userState?.inputType || "unknown";
  const scenario = userState?.scenario || "normal";
  const context = userState?.context || {};

  const contactAllowed = context.contactAllowed;
  const recommendedAction = context.recommendedAction || "";
  const mainRisk = context.mainRisk || "";

  return `
ユーザー入力：
${input}

入力タイプ：
${inputType}

シナリオ：
${scenario}

前回ルール：
contactAllowed: ${contactAllowed}
recommendedAction: ${recommendedAction}
mainRisk: ${mainRisk}

【最重要ルール】
・日本語のみ
・短く
・A/B禁止
・【結論】禁止
・質問で返すのは禁止
・ユーザーに考えさせるのは禁止
・説明させるのは禁止
・疑問文（？）で終わる返信は禁止
・出力は「判断」「送るLINE」「注意」の3つだけ
・送るLINEは1つだけ出す

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
・前回の判断と矛盾しない
・追加質問ではなく次に送る一言を出す

【上下文ルール】

■ contactAllowed が false の場合
・相手に追加で連絡する提案は禁止
・追いLINEは禁止
・理由を聞く提案は禁止
・関係確認は禁止
・謝罪を重ねる提案は禁止
・説得は禁止
・基本方針は「待つ」「距離を置く」「圧を下げる」
・送るなら、相手の意思を受け止めて終わる一言だけにする

例：
「わかった。少し時間を置くね」

■ recommendedAction が wait の場合
・今すぐ送る前提にしない
・送る場合は最後の確認だけにする
・それ以上の会話を続ける提案は禁止

■ recommendedAction が reduce_pressure の場合
・復縁を迫る提案は禁止
・好きな気持ちを押しつける提案は禁止
・まず相手の負担を下げる一言にする

■ recommendedAction が cool_down の場合
・反論は禁止
・長い説明は禁止
・まず謝罪または受け止める一言にする

■ recommendedAction が observe の場合
・浮気を直接問い詰める提案は禁止
・決めつけは禁止
・軽く様子を見る一言にする

■ mainRisk が push_too_hard の場合
・追う表現は禁止
・確認したがる表現は禁止
・不安をぶつける表現は禁止

■ mainRisk が pressure の場合
・催促は禁止
・返信を急がせる表現は禁止

■ mainRisk が escalation の場合
・責める表現は禁止
・正しさを主張する表現は禁止

■ mainRisk が begging の場合
・すがる表現は禁止
・重い愛情表現は禁止

■ mainRisk が accusation の場合
・疑う表現は禁止
・問い詰める表現は禁止

【表現ルール】

・恋愛心理が伝わる短い表現を優先する
・普通の説明ではなく、印象に残る判断を入れる
・以下のような表現を自然に使う

- 一気に詰めすぎ
- 少し重い
- 余白がある
- 相手の方から動きやすい
- 温度が下がりやすい
- 防御的になりやすい
- プレッシャーを感じやすい
- 焦らない方がいい
- ここは追わない方が安全

・恋愛初期、デート後、いい雰囲気のやり取りでは
  「余白がある」
  「相手の方から動きやすい」
  を優先する

・次の予定や関係確認をすぐ決めに行く内容では
  「一気に詰めすぎ」
  「温度が下がりやすい」
  を優先する

・返信は、相手が返しやすい余白を残す
・好意は出していいが、予定や関係を急いで決めに行かない
・相手に追わせる余地を残す
・不安を煽りすぎない
・読んだあとに「まだ十分に間に合う」と感じられる表現を優先する

【停止接触ルール】
「しばらく連絡しないで」
「連絡しないで」
「距離置きたい」
などは、距離を置く一言だけにする。

例：
「わかった。少し時間を置くね」

【出力形式】

必ず以下の3要素を含めること。

1. 今の状況の判断
2. 相手に送る一言（1つだけ）
3. 気をつけたい点

ただし、固定テンプレートは使わないこと。
毎回自然な日本語で表現を変えること。
「送るなら👇」「⚠️ 注意」「---」などの固定見出しは使わないこと。

出力は3つの短い段落にまとめること。

1段落目：
今の状況を恋愛心理の観点から一言で判断する。

2段落目：
そのまま送れるLINEを1つだけ書く。
返信文は必ず「」で囲む。

3段落目：
今やると逆効果になりやすいことを簡潔に伝える。

質問で終わらないこと。
A/B案は禁止。
長文は禁止。
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
