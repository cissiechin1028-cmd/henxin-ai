function cleanup(text) {
  return (text || "")
    .replace(/\r/g, "")
    .trim();
}

function normalize(text) {
  return text
    .replace(/【今はどうする？】/g, "")
    .replace(/【送る場合の例】/g, "")
    .replace(/📩\s*送るならこのまま使ってOK/g, "")
    .replace(/👉\s*しっくりくるものをそのまま使ってOK/g, "👉しっくりくるものをそのまま使ってOK")
    .replace(/「/g, "")
    .replace(/」/g, "");
}

function parseOptions(text) {
  const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
  const options = [];

  for (const line of lines) {
    const m = line.match(/^([①②③])\s*(.*)$/);
    if (m) {
      options.push({ no: m[1], text: m[2].trim() });
    }
  }

  return options;
}

function scoreOption(text, fullText) {
  let score = 0;

  if (/[？?]/.test(text)) score += 2;
  if (/落ち着いた|元気|どう|話せ/.test(text)) score += 1;
  if (/嬉しい|ちょっと/.test(text)) score += 1;

  if (/無理しないでね/.test(text) && !/[？?]/.test(text)) score -= 2;
  if (/またタイミング|待ってる|いつでも/.test(text)) score -= 1;

  const failed = /既読無視|無視された|返事来ない|同じような/.test(fullText);
  if (failed) {
    if (/また落ち着いたら|待ってる|いつでも/.test(text)) score -= 3;
    if (/無理しないで/.test(text)) score -= 2;
    if (/話題変え|最近どう/.test(text)) score += 3;
    if (/[？?]/.test(text)) score += 1;
  }

  return score;
}

function chooseRecommended(options, fullText) {
  if (!options.length) return "②";

  let bestNo = "②";
  let bestScore = -999;

  for (const opt of options) {
    const s = scoreOption(opt.text, fullText);
    if (s > bestScore) {
      bestScore = s;
      bestNo = opt.no;
    }
  }

  return bestNo;
}

function ensureSelectorHint(text) {
  if (text.includes("👉しっくりくるものをそのまま使ってOK")) return text;

  const lines = text.split("\n");
  const insertAt = lines.findIndex((line) => /^③/.test(line));

  if (insertAt !== -1) {
    lines.splice(insertAt + 1, 0, "👉しっくりくるものをそのまま使ってOK");
    return lines.join("\n");
  }

  return text;
}

function replaceRecommended(text, rec) {
  if (/⭐おすすめ：\s*[①②③]/.test(text)) {
    return text.replace(/⭐おすすめ：\s*[①②③]/, `⭐おすすめ：${rec}`);
  }

  return `${text}\n\n⭐おすすめ：${rec}`;
}

function postprocessReply(aiText) {
  let text = cleanup(aiText);
  text = normalize(text);

  const options = parseOptions(text);

  // 只有真正是三选一输出时才处理
  if (options.length >= 3) {
    const rec = chooseRecommended(options, text);
    text = ensureSelectorHint(text);
    text = replaceRecommended(text, rec);
  }

  return text.trim();
}

module.exports = { postprocessReply };
