function detectScene(text) {
  // 1️⃣ 分手 / 高风险（必须优先）
  if (/(別れ|終わり|無理|距離置きたい|別れそう|もう無理)/.test(text)) {
    return "break";
  }

  // 2️⃣ 已读不回 / 无回应
  if (/(既読無視|既読スルー|未読|返事来ない|返事が来ない|返信ない|返信来ない|見てるのに返さない)/.test(text)) {
    return "ignore";
  }

  // 3️⃣ 解释型（忙 / 没空）
  if (/(忙しい|余裕ない|バタバタ|仕事|落ち着いたら)/.test(text)) {
    return "explain";
  }

  // 4️⃣ 冷淡 / 温度下降
  if (/(冷たい|そっけない|返信遅い|温度差)/.test(text)) {
    return "cold";
  }

  // 5️⃣ 好感暴露
  if (/(好き|気になる|好きバレ|バレた)/.test(text)) {
    return "like";
  }

  // 6️⃣ 默认
  return "normal";
}

module.exports = { detectScene };
