// services/riskLevel.js

function detectRiskLevel(text = "", scenario = "normal") {
  const t = String(text);

  if (
    scenario === "breakup" ||
    /別れたい|別れよう|もう無理|距離置きたい|好きじゃない|冷めた|終わり|しばらく連絡しないで|連絡しないで|もういい/.test(t)
  ) {
    return 4;
  }

  if (
    scenario === "cheating" ||
    scenario === "reunion" ||
    /浮気|怪しい|復縁|元彼|元カノ|やり直したい|戻りたい/.test(t)
  ) {
    return 3;
  }

  if (
    scenario === "ignore" ||
    scenario === "cold" ||
    /既読|未読|無視|冷たい|返信遅い|距離|そっけない|バタバタ|忙しい/.test(t)
  ) {
    return 2;
  }

  return 1;
}

function getRiskJudge(level, scenario) {
  if (level >= 4) {
    return "今は、ここでの一言で関係が切れるかどうか分かれる場面です。";
  }

  if (level === 3) {
    if (scenario === "reunion") {
      return "今は、気持ちを伝える段階ではなく、警戒を解く段階です。";
    }

    if (scenario === "cheating") {
      return "今は、問い詰めるほど相手の本音が見えなくなる場面です。";
    }

    return "今は、動き方を間違えると距離が固定されやすい場面です。";
  }

  if (level === 2) {
    if (scenario === "cold") {
      return "今は、理由を聞くよりも温度を戻す方が先です。";
    }

    if (scenario === "ignore") {
      return "今は、追うほど相手の温度が下がりやすい場面です。";
    }

    return "今は、少しでも重くすると距離が広がりやすい状態です。";
  }

  return "今は、相手の反応を見ながら崩さない方が安全です。";
}

module.exports = {
  detectRiskLevel,
  getRiskJudge
};
