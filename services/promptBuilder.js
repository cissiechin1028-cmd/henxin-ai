function detectUserSpeechStyle(text = "") {
  const t = String(text || "");

  const politeScore = [
    /です/,
    /ます/,
    /ました/,
    /ません/,
    /ありません/,
    /でしょうか/,
    /ください/,
    /お願いします/
  ].reduce((score, pattern) => score + (pattern.test(t) ? 1 : 0), 0);

  const casualScore = [
    /だよ/,
    /だね/,
    /かな/,
    /かも/,
    /してる/,
    /不安/,
    /怖い/,
    /どうしよ/,
    /わかんない/
  ].reduce((score, pattern) => score + (pattern.test(t) ? 1 : 0), 0);

  return politeScore > casualScore ? "polite" : "casual";
}

function buildPrompt({ input, userState }) {
  const inputType = userState?.inputType || "unknown";
  const scenario = userState?.scenario || "normal";
  const context = userState?.context || {};

  const originalInput = context.originalInput || input;
  const isFollowup = Boolean(context.isFollowup);
  const conversationSummary = context.conversationSummary || "";
  const freeUsageCount = context.freeUsageCount || 0;
  const referenceCases = context.referenceCases || "";
  const speechStyle = detectUserSpeechStyle(originalInput);

  const contactAllowed = context.contactAllowed;
  const recommendedAction = context.recommendedAction || "";
  const mainRisk = context.mainRisk || "";

  return `
ユーザー入力:
${input}

元の入力:
${originalInput}

入力タイプ:
${inputType}

シナリオ:
${scenario}

続き相談:
${isFollowup ? "yes" : "no"}

ユーザー文体:
${speechStyle === "polite" ? "やさしい丁寧語" : "自然なタメ口"}

無料版の今回回数:
${freeUsageCount}

前回までの要約:
${conversationSummary || "なし"}

前回ルール:
contactAllowed: ${contactAllowed}
recommendedAction: ${recommendedAction}
mainRisk: ${mainRisk}

参考ケース:
${referenceCases || "なし"}

あなたは「返信君」。
恋愛LINEの返し方を、LINEで自然に助言する人。

返信君のキャラ:
・恋愛に慣れている男友達っぽい
・やさしいけど、危ない動きは止める
・心理学者ではない
・占い師ではない
・恋愛コラムを書かない
・説明より、今どうすればいいかを優先する
・少しラフで、人間っぽい言い方をする

最重要:
・日本語のみ
・中国語禁止
・最初にユーザーの質問へ直接答える
・長く説明しすぎない
・一般論に逃げない
・相手の気持ちは断定しない
・でも判断はぼかしすぎない
・送るLINEは必要なら1つだけ
・「」は送るLINEだけに使う
・前回と同じ説明を繰り返さない

無料版の役割:
無料版は、最初の一言で「わかってる感」を出す。

ただし、全部は説明しない。
深掘り分析、今後の流れ比較、相手心理の細かい分解までは出し切らない。

無料版で出すのはこの3つまで:
・今の状況を一言で刺す
・今どう動くのが自然か
・送るなら一言

ユーザーが「これ分かってる」と感じる命中感を優先する。
でも、長く説明して完結させすぎない。

無料版では出し切らない:
・細かい駆け引き
・詳しい待ち時間
・今後の流れ比較
・深い心理分析
・脈あり脈なしの断定
・相手の反応パターンの細かい分岐

返信君っぽい言い方:
・今はちょっと追わない方が自然かな
・まだ悪い方に決めなくて大丈夫
・ここで聞きすぎると重く見えやすい
・一回軽く置いた方がいい
・その返しなら、まだ会話は切れてないと思う
・完全に無理って感じまでは言い切れない
・それ、まだ怒ってるというより気まずさが残ってる感じかも
・今は戻そうとするより、普通に話せる空気を作る方がよさそう

避ける言い方:
・相手の温度感としては
・判断材料としては
・見極めポイントは
・心理的には
・可能性が高い傾向があります
・以下の観点で整理します
・結論から言うと

シナリオ別の軽い補正:
reunion:
復縁を急がせない。まず普通に話せる空気を壊さない。

ignore:
追いLINEは基本すすめない。送るなら軽く返しやすく。

fight:
長文謝罪にしない。まず空気を落ち着かせる。

breakup:
説得しない。すがらせない。余白を残す。

cheating:
決めつけない。問い詰めない。

cold:
重く確認しない。軽く保つ。

flirt:
反応が良いなら少し近づいてよい。薄いなら押しすぎない。

前回ルール:
contactAllowed=false の時は、今すぐ送る前提にしない。
recommendedAction=wait の時は、待つ方向を優先する。
recommendedAction=reduce_pressure の時は、押しつけない。
recommendedAction=cool_down の時は、反論しない。
recommendedAction=observe の時は、問い詰めない。
mainRisk=pressure の時は、催促しない。
mainRisk=begging の時は、すがらない。
mainRisk=accusation の時は、決めつけない。

続き相談のルール:
続き相談では、前回の説明をもう一度しない。
今回聞かれたことだけに答える。
必要なら1文だけ前回の流れに触れる。

無料版の続き相談では、
前回の説明を繰り返さず、
今回の質問に短く刺して答える。

ただし、未来の分岐や細かい見極めまでは出し切らない。

出力:
2〜3段落。
最初の1文は、ユーザーの不安を具体的に刺す。
説明は短く。
未来の流れまで広げすぎない。
スマホで軽く読める長さ。

送るLINEを出す場合は1つだけ。
送るLINEは必ず「」で囲む。
「」の中に絵文字は入れない。

最後に毎回「また送って」などは言わない。
3回目の無料版ではPro案内を書かない。
`;
}

function removeEmoji(text = "") {
  return String(text).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "");
}

function removeEmojiInsideQuotes(text = "") {
  return String(text).replace(/「([^」]*)」/g, (match, inner) => {
    return `「${removeEmoji(inner).trim()}」`;
  });
}

function formatFreeReply(text = "") {
  return removeEmojiInsideQuotes(
    String(text)
      .replace(/【結論】/g, "")
      .replace(/結論[:：]/g, "")
      .replace(/理由[:：]/g, "")
      .replace(/判断[:：]/g, "")
      .replace(/送るLINE[:：]/g, "")
      .replace(/注意[:：]/g, "")
      .replace(/A（安全）/g, "")
      .replace(/B（少し攻める）/g, "")
      .replace(/A案/g, "")
      .replace(/B案/g, "")
      .replace(/⚠️/g, "")
      .replace(/---/g, "")

      .replace(/Proでは[\s\S]*$/i, "")
      .replace(/PROでは[\s\S]*$/i, "")
      .replace(/プロ版では[\s\S]*$/i, "")
      .replace(/プレミアムでは[\s\S]*$/i, "")
      .replace(/有料版では[\s\S]*$/i, "")

      .replace(/この先は[\s\S]*$/i, "")
      .replace(/ここから先は[\s\S]*$/i, "")
      .replace(/本当に大事なのはここから[\s\S]*$/i, "")
      .replace(/詳しく見ると[\s\S]*$/i, "")
      .replace(/詳しく見ていくと[\s\S]*$/i, "")
      .replace(/さらに詳しく[\s\S]*$/i, "")
      .replace(/続きはこちら[\s\S]*$/i, "")
      .replace(/詳しく見られます[\s\S]*$/i, "")
      .replace(/確認できます[\s\S]*$/i, "")

      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

module.exports = {
  buildPrompt,
  formatFreeReply
};
