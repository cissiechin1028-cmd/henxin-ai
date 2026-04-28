// services/messageClassifier.js

function normalize(text = "") {
  return String(text).trim();
}

function isGreeting(text) {
  return /^(こんにちは|こんばんは|おはよう|おはようございます|お疲れ様|お疲れ様です|はじめまして|よろしく|よろしくお願いします|hi|hello)$/i.test(text);
}

function isThanksOnly(text) {
  return /^(ありがとう|ありがとうございます|助かります|助かりました|了解|わかりました|分かりました|お願いします|お願い)$/i.test(text);
}

function hasSituationWords(text) {
  return /返信|既読|未読|冷たい|距離|別れ|復縁|浮気|怪しい|喧嘩|ブロック|好き|告白|誘い|デート|会いたい|連絡|LINE|脈あり|脈なし|不安|彼氏|彼女|元彼|元カノ|相手/.test(text);
}

function looksLikePartnerMessage(text) {
  const t = normalize(text);

  if (t.length <= 2) return false;

  // 相手が送ってきそうな短文
  if (/^(最近バタバタして|忙しい|ごめん|また連絡する|今忙しい|考えさせて|距離置きたい|別れたい|無理かも|予定わかったら連絡する|寝てた|仕事だった|了解|うん|そうだね|大丈夫|ありがとう|ごめんね)/.test(t)) {
    return true;
  }

  // 句読点や会話っぽい終わり方
  if (/(だよ|だね|かな|かも|ごめん|笑|w|！|？|\?|😊|🙂|💦|🙇|🙏)$/.test(t) && !hasSituationWords(t)) {
    return true;
  }

  // カギカッコ内の文面
  if (/「.+」/.test(t)) return true;

  return false;
}

function isSituationDescription(text) {
  const t = normalize(text);

  if (hasSituationWords(t)) return true;

  if (/どう返せば|なんて返せば|返信したい|返事したい|送っていい|これどう|どう思う|脈あり|脈なし/.test(t)) {
    return true;
  }

  return false;
}

function classifyMessage(text) {
  const t = normalize(text);

  if (!t) return "empty";

  if (isGreeting(t)) return "greeting";

  if (isThanksOnly(t)) return "thanks";

  if (looksLikePartnerMessage(t)) return "partner_message";

  if (isSituationDescription(t)) return "situation";

  return "unclear";
}

module.exports = {
  classifyMessage,
  isGreeting,
  isSituationDescription,
  looksLikePartnerMessage
};
