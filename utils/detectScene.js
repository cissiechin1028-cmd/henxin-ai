// detectScene.js

function normalizeText(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/[！!？?。、,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text, keywords) {
  return keywords.some((word) => text.includes(word));
}

function detectScene(input = "") {
  const text = normalizeText(input);

  // 1. 別れ・距離置き・復縁系：最優先
  const breakKeywords = [
    "距離置きたい",
    "距離を置きたい",
    "距離置こう",
    "距離を置こう",
    "少し距離",
    "冷却期間",
    "別れたい",
    "別れよう",
    "別れ話",
    "終わりにしたい",
    "もう終わり",
    "もう無理",
    "無理かも",
    "好きじゃない",
    "気持ちがない",
    "気持ちわからない",
    "考えたい",
    "一回考えたい",
    "関係を考えたい",
    "元カレ",
    "元カノ",
    "復縁",
    "やり直したい"
  ];

  if (includesAny(text, breakKeywords)) {
    return "break";
  }

  // 2. 既読無視・未返信
  const ignoreKeywords = [
    "既読無視",
    "既読スルー",
    "未読無視",
    "未読スルー",
    "返事来ない",
    "返事こない",
    "返信来ない",
    "返信こない",
    "返ってこない",
    "返って来ない",
    "返ってこなくて",
    "返してくれない",
    "連絡来ない",
    "連絡こない",
    "既読ついてる",
    "既読ついた",
    "既読なのに",
    "既読だけ",
    "スルーされてる"
  ];

  if (includesAny(text, ignoreKeywords)) {
    return "ignore";
  }

  // 3. 忙しい・余裕ない・謝罪説明
  const explainKeywords = [
    "忙しい",
    "仕事が忙しい",
    "バタバタ",
    "余裕ない",
    "余裕がない",
    "時間ない",
    "時間がない",
    "返信遅れて",
    "返信遅く",
    "返事遅れて",
    "遅くなって",
    "ごめん",
    "ごめんね",
    "ごめんなさい",
    "申し訳ない",
    "すみません",
    "落ち着いたら",
    "また連絡する",
    "今週忙しい",
    "最近忙しい"
  ];

  if (includesAny(text, explainKeywords)) {
    return "explain";
  }

  // 4. 冷たい・そっけない・温度低下
  const coldKeywords = [
    "冷たい",
    "そっけない",
    "素っ気ない",
    "塩対応",
    "返信短い",
    "返事短い",
    "スタンプだけ",
    "うんだけ",
    "うん",
    "そうだね",
    "へー",
    "ふーん",
    "温度差",
    "距離感じる",
    "前より冷たい",
    "前より返信",
    "会話続かない",
    "盛り上がらない"
  ];

  if (includesAny(text, coldKeywords)) {
    return "cold";
  }

  // 5. 好き・脈あり・いい感じ
  const likeKeywords = [
    "好き",
    "気になる",
    "脈あり",
    "脈なし",
    "いい感じ",
    "好意",
    "両思い",
    "付き合いたい",
    "デート",
    "会いたい",
    "また会いたい",
    "楽しい",
    "かわいい",
    "可愛い",
    "褒められた",
    "誘われた"
  ];

  if (includesAny(text, likeKeywords)) {
    return "like";
  }

  return "default";
}

module.exports = detectScene;
