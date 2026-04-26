function detectRisk(text) {
  // 1. 致命风险：分手、拒绝、关系断裂
  if (/(別れ|終わり|無理|もう無理|距離置きたい|別れそう|会えない|今後会わない|もう会わない)/.test(text)) {
    return "critical";
  }

  // 2. 高风险：无回应、已读不回、追发后无回应
  if (/(既読無視|既読スルー|未読|返事来ない|返事が来ない|返信ない|返信来ない|見てるのに返さない|送ったけど返ってこない)/.test(text)) {
    return "high";
  }

  // 3. 中风险：忙、冷淡、余裕低下
  if (/(忙しい|余裕ない|バタバタ|仕事|落ち着いたら|冷たい|そっけない|返信遅い|温度差|疲れてる)/.test(text)) {
    return "medium";
  }

  // 4. 默认低风险
  return "low";
}

module.exports = { detectRisk };
