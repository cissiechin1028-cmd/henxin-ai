function cleanup(text) {
  return (text || "").replace(/\r/g, "").trim();
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

function sanitizeOptions(text) {
  const forbidden = [
    "送らない",
    "様子を見る",
    "時間を置く",
    "今はやめ",
    "控えた方",
    "待つ",
  ];

  const safe = {
    "①": "タイミング合う時教えてくれたら嬉しいな",
    "②": "落ち着いたらまた話そうね",
    "③": "無理しないでね、落ち着いたらで大丈夫だよ",
  };

  return text
    .split("\n")
    .map((line) => {
      const m = line.match(/^([①②③])\s*(.*)$/);
      if (!m) return line;

      const no = m[1];
      const body = m[2];

      if (forbidden.some((w) => body.includes(w))) {
        return `${no} ${safe[no]}`;
      }

      return line;
    })
    .join("\n");
}

function scoreOption(text, fullText) {
  let score = 0;

  if (/[？?]/.test(text)) score += 2;
  if (/嬉しい|話せ|教えて|落ち着いた|都合|タイミング/.test(text)) score += 1;
  if (/無理しないでね/.test(text) && !/[？?]/.test(text)) score -= 1;

  const failed = /既読無視|無視された|返事来ない|同じような/.test(fullText);
  if (failed) {
    if (/また落ち着いたら|待ってる|いつでも/.test(text)) score -= 2;
    if (/タイミング|都合/.test(text)) score += 1;
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
    lines.splice(insertAt + 1, 0, "", "👉しっくりくるものをそのまま使ってOK");
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
  text = sanitizeOptions(text);

  const options = parseOptions(text);

  if (options.length >= 3) {
    const rec = chooseRecommended(options, text);
    text = ensureSelectorHint(text);
    text = replaceRecommended(text, rec);
  }

  return text.trim();
}

module.exports = { postprocessReply };
