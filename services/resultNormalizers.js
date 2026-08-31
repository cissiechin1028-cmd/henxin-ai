function cleanString(value, max, required = false) {
  const text = typeof value === "string" ? value.trim().slice(0, max) : "";
  if (required && !text) throw new Error("AI_INVALID_RESULT");
  return text;
}

function score(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 100) throw new Error("AI_INVALID_SCORE");
  return number;
}

const { SCORE_VERSION, ANALYSIS_VERSION, calculateOverallScore } = require("./fiveDimensionScoring");

function cleanReplyText(value, locale) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error("AI_INVALID_RESULT");
  if (locale === "en") {
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words > 50 || text.length > 360) throw new Error("AI_REPLY_TOO_LONG");
  } else if (text.length > (locale === "zh-TW" ? 100 : 120)) {
    throw new Error("AI_REPLY_TOO_LONG");
  }
  return text;
}

function compactForDiversity(text) {
  return text.toLowerCase().replace(/[\s、。！？!?.,~〜ー…「」『』（）()]/g, "");
}

function scriptStats(value) {
  const text = String(value || "").replace(/https?:\/\/\S+/gi, " ");
  return {
    kana: (text.match(/[\u3040-\u30ff]/g) || []).length,
    han: (text.match(/[\u3400-\u9fff]/g) || []).length,
    latinLetters: (text.match(/[A-Za-z]/g) || []).length,
    latinWords: (text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).length,
  };
}

function languageMismatch(locale, reason, fieldIndex, stats) {
  const error = new Error(`AI_LANGUAGE_MISMATCH:${locale}:${reason}:field_${fieldIndex}`);
  error.code = "AI_LANGUAGE_MISMATCH";
  error.locale = locale;
  error.reason = reason;
  error.fieldIndex = fieldIndex;
  error.scriptStats = stats;
  throw error;
}

function assertLocale(strings, locale) {
  const values = strings.filter(value => typeof value === "string" && value.trim());
  if (!values.length) throw new Error("AI_INVALID_RESULT");
  const fields = values.map(scriptStats);
  const total = fields.reduce((sum, item) => ({
    kana: sum.kana + item.kana,
    han: sum.han + item.han,
    latinLetters: sum.latinLetters + item.latinLetters,
    latinWords: sum.latinWords + item.latinWords,
  }), { kana: 0, han: 0, latinLetters: 0, latinWords: 0 });

  if (locale === "en") {
    const fieldIndex = fields.findIndex(item => item.kana + item.han >= 6 && item.latinWords < 3);
    if (fieldIndex >= 0) languageMismatch(locale, "foreign_script_field", fieldIndex, fields[fieldIndex]);
    if (total.latinWords < 6 || total.kana + total.han > Math.max(24, Math.floor(total.latinLetters * 0.45))) {
      languageMismatch(locale, "english_not_dominant", -1, total);
    }
    return;
  }

  if (locale === "zh-TW") {
    const simplifiedChinese = /[这们吗让里为与从对请说还会么发后关爱应过进气间无实认给经长当样开点]/;
    const simplifiedIndex = values.findIndex(value => simplifiedChinese.test(value));
    if (simplifiedIndex >= 0) languageMismatch(locale, "simplified_chinese", simplifiedIndex, fields[simplifiedIndex]);
    const japaneseFieldIndex = fields.findIndex(item => item.kana >= 6 && item.han < 4);
    if (japaneseFieldIndex >= 0) languageMismatch(locale, "japanese_field", japaneseFieldIndex, fields[japaneseFieldIndex]);
    if (total.han < 6 || total.kana > Math.max(8, Math.floor(total.han * 0.25))) {
      languageMismatch(locale, "traditional_chinese_not_dominant", -1, total);
    }
    return;
  }

  const distinctiveChinese = /[這們嗎讓裡與從對請說還麼會]/;
  const highRiskChineseTerm = /約会/;
  const chineseIndex = values.findIndex(value => distinctiveChinese.test(value) || highRiskChineseTerm.test(value));
  if (chineseIndex >= 0) languageMismatch(locale, "chinese_wording", chineseIndex, fields[chineseIndex]);
  const nonJapaneseFieldIndex = fields.findIndex(item => item.han >= 8 && item.kana < 2 && item.latinWords < 3);
  if (nonJapaneseFieldIndex >= 0) languageMismatch(locale, "japanese_not_present_in_field", nonJapaneseFieldIndex, fields[nonJapaneseFieldIndex]);
  if (total.kana < 6) languageMismatch(locale, "japanese_not_dominant", -1, total);
}

function normalizeReply(raw, locale = "ja") {
  if (!Array.isArray(raw?.options) || raw.options.length !== 3) throw new Error("AI_INVALID_RESULT");
  const expectedStrategies = ["option_1", "option_2", "option_3"];
  const options = raw.options.map((item) => ({
    strategy: cleanString(item?.strategy, 24, true),
    text: cleanReplyText(item?.text, locale),
    reason: cleanString(item?.reason, 180, true),
  }));
  if (options.some((item, index) => item.strategy !== expectedStrategies[index])) throw new Error("AI_INVALID_RESULT");
  const recommended = options[0];
  const alternatives = options.slice(1).map(({ strategy, text, reason }) => ({ strategy, tone: strategy, text, reason }));
  const currentState = cleanString(raw.currentState, 300, true);
  const conversationTemperature = score(raw.conversationTemperature);
  assertLocale([currentState, ...options.flatMap(item => [item.text, item.reason])], locale);
  const compactReplies = options.map((item) => compactForDiversity(item.text));
  if (new Set(compactReplies).size !== 3) throw new Error("AI_DUPLICATE_REPLIES");
  return {
    kind: "reply", conversationTemperature, currentState,
    temperatureReason: currentState, recommendedReply: recommended.text, recommendedPurpose: recommended.strategy,
    recommendedReason: recommended.reason, alternatives, reason: recommended.reason,
    conversationRead: currentState, timelineEvent: normalizeTimelineEvent(raw.timelineEvent, locale),
  };
}

function normalizeAnalysis(raw, locale = "ja", options = {}) {
  if (!Array.isArray(raw?.signals_to_observe) || raw.signals_to_observe.length < 1 || raw.signals_to_observe.length > 3) throw new Error("AI_INVALID_RESULT");
  const dimensions = {
    topic_compatibility: score(raw.topic_compatibility), tempo_compatibility: score(raw.tempo_compatibility),
    interaction_balance: score(raw.interaction_balance), intimacy: score(raw.intimacy),
    excitement: score(raw.excitement),
  };
  const dimensionReasons = {
    topic_compatibility: cleanString(raw.dimension_reasons?.topic_compatibility, 160, true),
    tempo_compatibility: cleanString(raw.dimension_reasons?.tempo_compatibility, 160, true),
    interaction_balance: cleanString(raw.dimension_reasons?.interaction_balance, 160, true),
    intimacy: cleanString(raw.dimension_reasons?.intimacy, 160, true),
    excitement: cleanString(raw.dimension_reasons?.excitement, 160, true),
  };
  const dimensionSummaries = {
    topic_compatibility: cleanString(raw.dimension_summary?.topic_compatibility, 420, true),
    tempo_compatibility: cleanString(raw.dimension_summary?.tempo_compatibility, 420, true),
    interaction_balance: cleanString(raw.dimension_summary?.interaction_balance, 420, true),
    intimacy: cleanString(raw.dimension_summary?.intimacy, 420, true),
    excitement: cleanString(raw.dimension_summary?.excitement, 420, true),
  };
  if (locale === "ja" && Object.values(dimensionSummaries).some((item) => Array.from(item.replace(/\s/g, "")).length < 80 || Array.from(item.replace(/\s/g, "")).length > 180)) throw new Error("AI_DIMENSION_SUMMARY_LENGTH");
  if (locale === "ja" && Object.values(dimensionSummaries).some((item) => /今後|これから|期待できます|可能性が(?:あります|高いです)/.test(item))) throw new Error("AI_DIMENSION_SUMMARY_FUTURE");
  const overallScore = calculateOverallScore(dimensions);
  const overallReason = cleanString(raw.core_reason, 220, true);
  const actionAdvice = cleanString(raw.action_advice, 220, true);
  const signalsToObserve = raw.signals_to_observe.map((item) => cleanString(item, 160, true));
  assertLocale([overallReason, actionAdvice, ...Object.values(dimensionReasons), ...Object.values(dimensionSummaries), ...signalsToObserve], locale);
  return {
    kind: "analysis", outputLocale: locale, analysisVersion: ANALYSIS_VERSION, scoreVersion: SCORE_VERSION, overallScore, dimensions, dimensionReasons, dimensionSummaries,
    dataWindow: options.dataWindow || null,
    overallReason, actionAdvice, signalsToObserve,
    keyMoments: [], timelineEvent: normalizeTimelineEvent(raw.timelineEvent, locale),
  };
}

function normalizeTimelineEvent(raw, locale = "ja") {
  if (!raw?.shouldRecord || raw.evidenceStrength !== "clear") return { shouldRecord: false };
  const eventDate = raw.eventDate && /^\d{4}-\d{2}-\d{2}$/.test(raw.eventDate) ? raw.eventDate : null;
  const title = cleanString(raw.title, 120, true);
  const note = cleanString(raw.aiSummary, 220, true);
  assertLocale([title, note], locale);
  return {
    shouldRecord: true, eventType: cleanString(raw.eventType, 64, true),
    title, note, eventDate,
  };
}

module.exports = { assertLocale, normalizeReply, normalizeAnalysis, normalizeTimelineEvent };
