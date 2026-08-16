const LOCALES = {
  ja: `Think and compose the answer directly in natural contemporary Japanese. Do not draft in another language and translate it. Every user-facing field must contain Japanese only; never mix in Chinese or English sentences, including in reasons, summaries, event titles, or suggestions. Match Japanese conversational rhythm, politeness, sentence length, punctuation, and emoji use. Respect Japanese indirectness and conversational timing without assuming that brevity or delayed replies mean rejection. Avoid stiff written Japanese, translated phrasing, and repetitive stock phrases such as 「大丈夫だよ」「無理しないでね」「また落ち着いたら話そう」 unless the conversation genuinely calls for them. Never use the Chinese word 「約会」 in Japanese output; choose natural wording such as 「デート」「会う予定」「デートプラン」 according to context.`,
  "zh-TW": `請直接以自然的台灣繁體中文思考並撰寫，不得先用日文或其他語言起草後再翻譯。所有面向使用者的內容都只能使用台灣繁體中文與台灣常用詞，包括理由、摘要、事件標題與建議；不得混入日文或英文句子。語氣自然、真誠、清楚，依台灣日常溝通習慣調整句型與措辭，不使用中國大陸用語或翻譯腔。可以直接表達感受，但不要逼迫對方表態，也不要把簡短回覆或回覆間隔單獨視為拒絕。`,
  en: `Think and compose the answer directly in natural contemporary English. Do not draft in Japanese or another language and translate it. Every user-facing field must contain English only; never mix in Japanese or Chinese text, including in reasons, summaries, event titles, or suggestions. Follow natural English-speaking communication patterns rather than Japanese sentence structure. Respect direct communication, consent, and personal boundaries. Do not overread brevity or response delay, and avoid therapy-speak, canned dating advice, and overly polished AI phrasing.`
};

function localeRules(locale) {
  return LOCALES[locale] || LOCALES.ja;
}

module.exports = { localeRules };
