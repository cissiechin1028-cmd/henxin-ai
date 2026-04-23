function pickRecommendedIndex(text) {
  const lines = text.split("\n");

  const options = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^[①②③]\s*(.*)/);
    if (m) {
      options.push({ index: i, text: m[1] });
    }
  }

  if (options.length < 3) return 2;

  function score(s) {
    let sc = 0;

    // 更容易被回复
    if (/[？?]/.test(s)) sc += 2;

    // 有一点情绪或余白
    if (/嬉しい|話せ|教えて|落ち着いた|元気/.test(s)) sc += 1;

    // 太保守
    if (/無理しないでね/.test(s) && !/[？?]/.test(s)) sc -= 2;

    // 太后退
    if (/またタイミング|また今度|いつでも待ってる/.test(s)) sc -= 1;

    return sc;
  }

  let best = 2;
  let bestScore = -999;

  options.forEach((opt, idx) => {
    const sc = score(opt.text);
    if (sc > bestScore) {
      bestScore = sc;
      best = idx + 1;
    }
  });

  return best;
}

function injectSelectorHint(text) {
  if (text.includes("しっくりくるものをそのまま使ってOK")) {
    return text;
  }

  return text.replace(
    /(③[^\n]*\n?)/,
    `$1👉しっくりくるものをそのまま使ってOK\n`
  );
}

function replaceRecommended(text, rec) {
  const symbol = rec === 1 ? "①" : rec === 3 ? "③" : "②";

  if (/⭐おすすめ：\s*[①②③]/.test(text)) {
    return text.replace(/⭐おすすめ：\s*[①②③]/, `⭐おすすめ：${symbol}`);
  }

  return text;
}

function postprocessReply(aiText) {
  let text = (aiText || "").trim();

  // 只有三案输出时才处理
  if (!/①/.test(text) || !/②/.test(text) || !/③/.test(text)) {
    return text;
  }

  const rec = pickRecommendedIndex(text);
  text = replaceRecommended(text, rec);
  text = injectSelectorHint(text);

  return text;
}

module.exports = { postprocessReply };
