// services/messageClassifier.js

function normalize(text = "") {
  return String(text).trim();
}

function isGreeting(text) {
  return /^(こんにちは|こんばんは|おはよう|おはようございます|お疲れ様|お疲れ様です|はじめまして|よろしく|よろしくお願いします|hi|hello)$/i.test(text);
}

function isThanksOnly(text) {
  return /^(ありがとう|ありがとうございます|助かります|了解|わかりました|分かりました)$/i.test(text);
}

function hasSituationWords(text) {
  return /返信|既読|未読|冷たい|距離|別れ|復縁|浮気|怪しい|喧嘩|ブロック|好き|告白|誘い|デート|会いたい|連絡|LINE|脈あり|脈なし|相談|状況|どう返せば|なんて返せば/.test(text);
}

function looksLikePartnerMessage(text) {
  const t = normalize(text);

  if (!t) return false;
  if (t.length <= 2) return false;

  if (/疲れた|もういい|連絡しないで|距離置きたい|もう無理|一人にして|考えたい|冷めた|別れたい/.test(t)) {
    return true;
  }

  if (/^(最近バタバタして|忙しい|ごめん|また連絡する|今忙しい|考えさせて|了解|うん|そうだね|大丈夫|ありがとう|ごめんね)/.test(t)) {
    return true;
  }

  if (/「.+」/.test(t)) return true;

  if (/(だよ|だね|かな|かも|ごめん|笑|！|？|\?|😊|🙂|💦|🙏)$/.test(t)) {
    return true;
  }

  return false;
}

function isSituationDescription(text) {
  const t = normalize(text);

  if (/どう返せば|なんて返せば|返信したい|返事したい|どう思う|相談/.test(t)) {
    return true;
  }

  if (hasSituationWords(t) && t.length > 20) {
    return true;
  }

  return false;
}

function classifyMessage(text) {
  const t = normalize(text);

  if (!t) return "empty";

  if (isGreeting(t)) return "greeting";

  if (isThanksOnly(t)) return "thanks";

  if (/相手から|相手のメッセージ|これは相手|これ相手/.test(t)) {
    return "unclear";
  }

  if (looksLikePartnerMessage(t)) {
    return "partner_message";
  }

  if (t.length <= 20 && !/返信|どう|状況|相談|冷たい|脈/.test(t)) {
    return "partner_message";
  }

  if (isSituationDescription(t)) {
    return "situation";
  }

  return "unclear";
}

module.exports = {
  classifyMessage
};
