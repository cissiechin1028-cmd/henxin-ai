function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function detectTiming(text) {
  const s = text || "";

  // 未回复 / 已读不回 / 返信なし
  if (
    /既読無視|未読|返信来ない|返信がない|未返信|已读不回|没回我|No reply|didn’t reply|didn't reply/i.test(
      s
    )
  ) {
    return pickRandom([
      "少し時間を空けてから",
      "今日の夜",
      "明日の昼ごろ",
    ]);
  }

  // 道歉 / 情绪重 / 冷静
  if (
    /ごめん|謝りたい|言いすぎた|重い|しんどい|つらい|寂しい|冷たかった|喧嘩|けんか/i.test(
      s
    )
  ) {
    return pickRandom([
      "少し時間を空けてから",
      "落ち着いてから",
      "今日の夜",
    ]);
  }

  // 约见 / 轻松话题 / 想聊天
  if (
    /会いたい|話したい|気になる|最近どう|元気|暇|今何してる/i.test(s)
  ) {
    return pickRandom([
      "今すぐ",
      "今日の夜",
      "この話題が自然に出たとき",
    ]);
  }

  // 默认
  return pickRandom([
    "今すぐ",
    "少し時間を空けてから",
    "今日の夜",
  ]);
}

function parseRecommended(text) {
  const match = text.match(/⭐おすすめ：\s*([①②③123])/);
  if (!match) return null;

  const raw = match[1];
  if (raw === "①" || raw === "1") return 1;
  if (raw === "②" || raw === "2") return 2;
  if (raw === "③" || raw === "3") return 3;
  return null;
}

function replaceRecommended(text, n) {
  const symbolMap = { 1: "①", 2: "②", 3: "③" };
  const symbol = symbolMap[n] || "①";

  if (/⭐おすすめ：\s*[①②③123]/.test(text)) {
    return text.replace(/⭐おすすめ：\s*[①②③123]/, `⭐おすすめ：${symbol}`);
  }

  return `${text.trim()}\n\n⭐おすすめ：${symbol}`;
}

function replaceTiming(text, timing) {
  if (/送信タイミング：.*/.test(text)) {
    return text.replace(/送信タイミング：.*/, `送信タイミング：${timing}`);
  }

  return `${text.trim()}\n送信タイミング：${timing}`;
}

function countRecentRecommended(history) {
  const recentAi = history
    .filter((item) => typeof item === "string" && item.startsWith("AI:"))
    .slice(-5);

  const counts = { 1: 0, 2: 0, 3: 0 };

  for (const item of recentAi) {
    const rec = parseRecommended(item);
    if (rec) counts[rec] += 1;
  }

  return counts;
}

function chooseBalancedRecommendation(currentText, history) {
  const current = parseRecommended(currentText);
  const counts = countRecentRecommended(history);

  // 如果当前不是①，就先保留
  if (current && current !== 1) return current;

  // 如果最近①明显过多，就强制从②③里选更少的那个
  if (counts[1] >= 3) {
    if (counts[2] < counts[3]) return 2;
    if (counts[3] < counts[2]) return 3;
    return Math.random() < 0.5 ? 2 : 3;
  }

  // 否则保留原推荐
  return current || 1;
}

function cleanupInternalLabels(text) {
  return text
    .replace(/^.*[A-EＡ-Ｅ]と判断しました。*\n?/gm, "")
    .replace(/^.*判定結果.*\n?/gm, "")
    .trim();
}

function postprocessReply(aiText, userMessage, history = []) {
  let text = cleanupInternalLabels(aiText);

  // 推荐编号保护
  const finalRec = chooseBalancedRecommendation(text, history);
  text = replaceRecommended(text, finalRec);

  // 时机后处理
  const finalTiming = detectTiming(userMessage);
  text = replaceTiming(text, finalTiming);

  return text;
}

module.exports = {
  postprocessReply,
};
