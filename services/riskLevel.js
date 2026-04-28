// services/riskLevel.js

function detectRiskLevel(text = "", scenario = "normal") {
  const t = String(text);

  if (
    scenario === "breakup" ||
    /別れたい|別れよう|もう無理|距離置きたい|好きじゃない|冷めた|終わり/.test(t)
  ) {
    return 4;
  }

  if (
    scenario === "cheating" ||
    scenario === "reunion" ||
    /浮気|怪しい|復縁|元彼|元カノ/.test(t)
  ) {
    return 3;
  }

  if (
    scenario === "ignore" ||
    scenario === "cold" ||
    /既読|未読|無視|冷たい|返信遅い|距離/.test(t)
  ) {
    return 2;
  }

  return 1;
}

function getRiskJudge(level, scenario) {
  if (level >= 4) {
    return "今は、返し方を間違えると関係が一気に切れやすい場面です。";
  }

  if (level === 3) {
    if (scenario === "cheating") {
      return "今は、問い詰めるほど本音が見えにくくなる場面です。";
    }

    if (scenario === "reunion") {
      return "今は、押すよりも相手の警戒を下げる方が大事な場面です。";
    }

    return "今は、動き方を間違えると距離が広がりやすい場面です。";
  }

  if (level === 2) {
    if (scenario === "ignore") {
      return "今は、追いLINEをすると相手の温度が下がりやすい場面です。";
    }

    if (scenario === "cold") {
      return "今は、重く返すよりも軽く温度を見る方が安全です。";
    }

    return "今は、相手の反応を見ながら軽く返す方が安全です。";
  }

  return "今は、自然に返して相手の反応を見るのがよさそうです。";
}

module.exports = {
  detectRiskLevel,
  getRiskJudge
};
