function classifyMessage(text) {
  const t = normalize(text);

  if (!t) return "empty";

  // ✅ 强制识别（最高优先级）
  if (/相手から|相手のメッセージ|これは相手|これ相手/.test(t)) {
    return "partner_message";
  }

  // ✅ 明显短句（优先级非常高）
  if (
    t.length <= 20 &&
    !/返信|どう|状況|冷たい|脈|相談/.test(t)
  ) {
    return "partner_message";
  }

  if (isGreeting(t)) return "greeting";

  if (isThanksOnly(t)) return "thanks";

  // ✅ 冷淡/拒绝句 强制识别
  if (/疲れた|もういい|連絡しないで|距離置きたい|もう無理|一人にして/.test(t)) {
    return "partner_message";
  }

  // ✅ 再判断对话句
  if (looksLikePartnerMessage(t)) return "partner_message";

  // ❗ situation 放后面
  if (isSituationDescription(t)) return "situation";

  return "unclear";
}
