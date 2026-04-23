function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ================== 时机判断 ==================
function detectTiming(text) {
  const s = text || "";

  // 未回复 / 已读不回
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

  // 情绪重 / 道歉
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

  // 轻松聊天 / 想聊
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

// ================== 推荐解析 ==================
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

// ================== 时机替换 ==================
function replaceTiming(text, timing) {
  if (/送信タイミング：.*/.test(text)) {
    return text.replace(/送信タイミング：.*/, `送信タイミング：${timing}`);
  }

  return `${text.trim()}\n送信タイミング：${timing}`;
}

// ================== 推荐均衡 ==================
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

  // 如果不是①，优先保留
  if (current && current !== 1) return current;

  // 如果①过多 → 分流到②③
  if (counts[1] >= 3) {
    if (counts[2] < counts[3]) return 2;
    if (counts[3] < counts[2]) return 3;
    return Math.random() < 0.5 ? 2 : 3;
  }

  return current || 1;
}

// ================== 清理内部标签 ==================
function cleanupInternalLabels(text) {
  return text
    .replace(/^.*[A-EＡ-Ｅ]と判断しました。*\n?/gm, "")
    .replace(/^.*判定結果.*\n?/gm, "")
    .trim();
}

// ================== 防模板 ==================
function removeRepeatedPatterns(text, history) {
  const recentAi = history
    .filter((item) => item.startsWith("AI:"))
    .slice(-3)
    .join("\n");

  const patterns = [
    "そうなんだ",
    "無理しないでね",
    "大変だね",
    "気をつけてね",
  ];

  let result = text;

  for (const p of patterns) {
    if (recentAi.includes(p)) {
      const regex = new RegExp(p, "g");
      result = result.replace(regex, "");
    }
  }

  return result;
}

// ================== 判断是否C类 ==================
function isSingleLineReply(text) {
  // 没有①②③结构 → 说明是确认类
  return !/①|②|③/.test(text);
}

// ================== 主处理 ==================
function postprocessReply(aiText, userMessage, history = []) {
  let text = cleanupInternalLabels(aiText);

  // 防模板
  text = removeRepeatedPatterns(text, history);

  // C类：直接返回
  if (isSingleLineReply(text)) {
    return text;
  }

  // 推荐保护
  const finalRec = chooseBalancedRecommendation(text, history);
  text = replaceRecommended(text, finalRec);

  // 时机处理
  const finalTiming = detectTiming(userMessage);
  text = replaceTiming(text, finalTiming);

  return text;
}

module.exports = {
  postprocessReply,
};
