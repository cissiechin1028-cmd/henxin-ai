// services/messageClassifier.js

function normalize(text = "") {
  return String(text).trim();
}

function isGreeting(text) {
  return /^(こんにちは|こんばんは|おはよう|おはようございます|お疲れ様|お疲れ様です|はじめまして|よろしく|よろしくお願いします|hi|hello)$/i.test(text);
}

function isThanksOnly(text) {
  return /^(ありがとう|ありがとうございます|助かります|了解|わかりました)$/i.test(text);
}

function hasSituationWords(text) {
  return /返信|既読|未読|冷たい|距離|別れ|復縁|浮気|怪しい|喧嘩|ブロック|好き|告白|誘い|デート|会いたい|連絡|LINE|脈あり|脈なし/.test(text);
}

function looksLikePartnerMessage(text) {
  const t = normalize(text);

  if (t.length <= 2) return false;

  // 👉 强制识别：冷淡 / 拒绝类
  if (/疲れた|連絡しないで|距離置きたい|もう無理|一人にして|考えたい/.test(t)) {
    return true;
  }

  // 👉 常见对方回复
  if (/^(最近バタバタして|忙しい|ごめん|また連絡する|今忙しい|考えさせて|了解|うん|そうだね)/.test(t)) {
    return true;
  }

  // 👉 句尾判断（像对话）
  if (/(だよ|だね|かな|かも|ごめん|笑|！|？|😊|🙂)$/.test(t) && !hasSituationWords(t)) {
    return true;
  }

  // 👉 带引号
  if (/「.+」/.test(t)) return true;

  return false;
}

function isSituationDescription(text) {
  const t = normalize(text);

  if (hasSituationWords(t)) return true;

  if (/どう返せば|なんて返せば|返信したい|どう思う/.test(t)) {
    return true;
  }

  return false;
}

function classifyMessage(text) {
  const t = normalize(text);

  if (!t) return "empty";

  // 👉 用户明确说是对方消息
  if (/相手から|相手のメッセージ|これは相手/.test(t)) {
    return "partner_message";
  }

  if (isGreeting(t)) return "greeting";

  if (isThanksOnly(t)) return "thanks";

  // 👉 优先判断对方消息
  if (looksLikePartnerMessage(t)) return "partner_message";

  if (isSituationDescription(t)) return "situation";

  return "unclear";
}

module.exports = {
  classifyMessage
};
