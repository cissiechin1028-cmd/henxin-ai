const LOCALES = {
  ja: `Write every user-facing field in natural contemporary Japanese. Match the visible level of politeness, sentence length, punctuation, and emoji use. Respect Japanese indirectness and conversational timing without assuming that brevity or delayed replies mean rejection. Avoid stiff written Japanese, translated phrasing, and repetitive stock phrases such as 「大丈夫だよ」「無理しないでね」「また落ち着いたら話そう」 unless the conversation genuinely calls for them.`,
  "zh-TW": `所有面向使用者的內容都使用台灣繁體中文與台灣常用詞。語氣自然、真誠、清楚，不使用中國大陸用語或翻譯腔。可以直接表達感受，但不要逼迫對方表態，也不要把簡短回覆或回覆間隔單獨視為拒絕。`,
  en: `Write every user-facing field in clear, contemporary, natural English. Respect direct communication, consent, and personal boundaries. Do not overread brevity or response delay, and avoid therapy-speak, canned dating advice, and overly polished AI phrasing.`
};

function localeRules(locale) {
  return LOCALES[locale] || LOCALES.ja;
}

module.exports = { localeRules };
