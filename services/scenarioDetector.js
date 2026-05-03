function detectScenario(text = "") {
  const t = String(text);

  if (/浮気|怪しい|隠して|女の子|男の子|他の人|嘘|泊まり|連絡取ってる/.test(t)) {
    return "cheating";
  }

  if (/別れたい|別れよう|距離置きたい|もう無理|好きじゃない|冷めた|終わり|さよなら|連絡しないで/.test(t)) {
    return "breakup";
  }

  if (/復縁|元彼|元カノ|やり直し|戻りたい|また話したい/.test(t)) {
    return "reunion";
  }

  if (/既読|未読|無視|返信ない|返事ない|返信こない|スルー/.test(t)) {
    return "ignore";
  }

  if (/冷たい|そっけない|距離|温度|返信遅い|忙しい|バタバタ/.test(t)) {
    return "cold";
  }

  if (/好き|告白|誘いたい|デート|会いたい|気になる|脈あり|脈なし/.test(t)) {
    return "flirt";
  }

  return "normal";
}

module.exports = { detectScenario };
