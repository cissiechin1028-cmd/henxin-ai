// detectRisk.js

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

function detectRisk({ text = "", scene = "default" } = {}) {
  const input = normalizeText(text);

  // 1. critical：別れ・復縁・距離置き
  const criticalKeywords = [
    "距離置きたい",
    "距離を置きたい",
    "距離置こう",
    "距離を置こう",
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
    "関係を考えたい",
    "考えたい",
    "元カレ",
    "元カノ",
    "復縁",
    "やり直したい"
  ];

  if (scene === "break" || includesAny(input, criticalKeywords)) {
    return "critical";
  }

  // 2. high：既読無視・未返信
  const highKeywords = [
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
    "返してくれない",
    "連絡来ない",
    "連絡こない",
    "既読ついてる",
    "既読ついた",
    "既読なのに",
    "スルーされてる"
  ];

  if (scene === "ignore" || includesAny(input, highKeywords)) {
    return "high";
  }

  // 3. medium：冷淡・忙しい・余裕ない
  const mediumKeywords = [
    "冷たい",
    "そっけない",
    "素っ気ない",
    "塩対応",
    "返信短い",
    "返事短い",
    "スタンプだけ",
    "温度差",
    "距離感じる",
    "会話続かない",
    "盛り上がらない",
    "忙しい",
    "余裕ない",
    "余裕がない",
    "時間ない",
    "時間がない",
    "返信遅れて",
    "返事遅れて",
    "遅くなって",
    "ごめん"
  ];

  if (
    scene === "cold" ||
    scene === "explain" ||
    includesAny(input, mediumKeywords)
  ) {
    return "medium";
  }

  // 4. low：好意・通常相談
  if (scene === "like") {
    return "low";
  }

  return "low";
}

module.exports = detectRisk;
