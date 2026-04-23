function cleanup(text) {
  return (text || "")
    .replace(/\r/g, "")
    .replace(/^\s+|\s+$/g, "");
}

function normalizeQuotes(text) {
  return text
    .replace(/“|”/g, '"')
    .replace(/‘|’/g, "'")
    .replace(/「\s*/g, "「")
    .replace(/\s*」/g, "」");
}

function limitEmojiInAdvice(text) {
  // 助言部分（📩より前）だけに emoji を最大1個許可
  const parts = text.split("📩");
  if (parts.length < 2) return text;

  let advice = parts[0];
  const rest = "📩" + parts.slice(1).join("📩");

  const allowed = ["🙂", "😊", "🤔", "👉"];
  let emojiCount = 0;

  advice = advice.replace(/[^\p{L}\p{N}\p{P}\p{Z}\n]/gu, (m) => {
    if (allowed.includes(m)) {
      emojiCount += 1;
      return emojiCount <= 1 || m === "👉" ? m : "";
    }
    return "";
  });

  return advice + rest;
}

function ensureSeparatedStructure(text) {
  let t = cleanup(normalizeQuotes(text));

  // 已经是目标结构就尽量不动
  if (t.includes("📩")) {
    return t;
  }

  // 兼容旧格式：①②③ / ⭐おすすめ 等
  const lines = t.split("\n").map((s) => s.trim()).filter(Boolean);

  const options = lines.filter((line) => /^([①②③]|\d+[.)])/.test(line));
  const nonOptions = lines.filter((line) => !/^([①②③]|\d+[.)])/.test(line));

  let advice = "👉 今は状況を見ながら、無理のない動き方を選ぶのがよさそう🙂";
  let reason = "";

  if (nonOptions.length > 0) {
    advice = nonOptions[0].startsWith("👉") ? nonOptions[0] : `👉 ${nonOptions[0]}`;
    reason = nonOptions.slice(1).join("\n");
  }

  let sendBlock = "";
  if (options.length > 0) {
    const cleaned = options
      .slice(0, 2)
      .map((x) => x.replace(/^([①②③]|\d+[.)])\s*/, "").trim())
      .filter(Boolean)
      .map((x) => `「${x.replace(/^「|」$/g, "")}」`);

    if (cleaned.length > 0) {
      sendBlock = `──────────\n\n📩 送るならこのまま使ってOK\n${cleaned.join("\n")}`;
    }
  }

  return [advice, reason, sendBlock].filter(Boolean).join("\n\n").trim();
}

function tightenAdvice(text) {
  const parts = text.split("──────────");
  let advice = parts[0] || "";
  const rest = parts.length > 1 ? "──────────" + parts.slice(1).join("──────────") : "";

  advice = advice
    .replace(/【今はどうする？】/g, "")
    .replace(/理由：/g, "")
    .replace(/タイミング：/g, "")
    .replace(/送信タイミング：/g, "")
    .replace(/⭐おすすめ：.*/g, "")
    .replace(/👉しっくりくるものをそのまま使ってOK/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const lines = advice.split("\n").map((s) => s.trim()).filter(Boolean);

  let first = lines[0] || "👉 今は無理に動かない方がよさそう🙂";
  if (!first.startsWith("👉")) first = `👉 ${first}`;

  const second = lines.slice(1).join(" ");
  const compact = second ? `${first}\n\n${second}` : first;

  return rest ? `${compact}\n\n${rest}` : compact;
}

function fixSendBlock(text) {
  if (!text.includes("📩")) return text;

  const [before, afterRaw] = text.split("📩");
  let after = afterRaw || "";

  // 只保留 1~2 条真正可复制文案
  let lines = after
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  lines = lines.filter(
    (line) =>
      !/^理由[:：]/.test(line) &&
      !/^タイミング[:：]/.test(line) &&
      !/^送信タイミング[:：]/.test(line) &&
      !/^⭐おすすめ/.test(line) &&
      !/^👉/.test(line)
  );

  // 兼容没有引号的情况
  lines = lines.map((line) => {
    const cleaned = line.replace(/^([①②③]|\d+[.)])\s*/, "").trim();
    if (!cleaned.startsWith("「")) return `「${cleaned.replace(/^「|」$/g, "")}」`;
    return cleaned;
  });

  lines = [...new Set(lines)].slice(0, 2);

  if (lines.length === 0) {
    return before.trim();
  }

  return `${before.trim()}\n\n──────────\n\n📩 送るならこのまま使ってOK\n${lines.join("\n")}`;
}

function postprocessReply(aiText) {
  let text = cleanup(aiText);
  text = ensureSeparatedStructure(text);
  text = tightenAdvice(text);
  text = fixSendBlock(text);
  text = limitEmojiInAdvice(text);

  return text.trim();
}

module.exports = { postprocessReply };
