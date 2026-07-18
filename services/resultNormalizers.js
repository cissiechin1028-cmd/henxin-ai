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

function assertLocale(strings, locale) {
  const text = strings.filter(Boolean).join("\n");
  if (!text) throw new Error("AI_INVALID_RESULT");
  const kana = /[\u3040-\u30ff]/;
  const cjk = /[\u3040-\u30ff\u3400-\u9fff]/;
  const strongTraditionalChinese = /[這個們嗎讓裡為與從對請說還會麼]/;
  if (locale === "en" && cjk.test(text)) throw new Error("AI_LANGUAGE_MISMATCH");
  if (locale === "zh-TW" && kana.test(text)) throw new Error("AI_LANGUAGE_MISMATCH");
  if (locale === "ja" && (strongTraditionalChinese.test(text) || !kana.test(text))) throw new Error("AI_LANGUAGE_MISMATCH");
}

function normalizeReply(raw, locale = "ja") {
  if (!Array.isArray(raw?.options) || raw.options.length !== 3) throw new Error("AI_INVALID_RESULT");
  const expectedStrategies = ["recommended", "assertive", "cautious"];
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
  return {
    kind: "reply", conversationTemperature, currentState,
    temperatureReason: currentState, recommendedReply: recommended.text, recommendedPurpose: recommended.strategy,
    recommendedReason: recommended.reason, alternatives, reason: recommended.reason,
    conversationRead: currentState,
  };
}

function normalizeAnalysis(raw, locale = "ja") {
  if (!Array.isArray(raw?.signals_to_observe) || raw.signals_to_observe.length < 1 || raw.signals_to_observe.length > 3) throw new Error("AI_INVALID_RESULT");
  const relationshipTrend = score(raw.relationship_trend);
  const overallReason = cleanString(raw.core_reason, 220, true);
  const actionAdvice = cleanString(raw.action_advice, 220, true);
  const signalsToObserve = raw.signals_to_observe.map((item) => cleanString(item, 160, true));
  assertLocale([overallReason, actionAdvice, ...signalsToObserve], locale);
  return {
    kind: "analysis",
    conversationBalance: score(raw.conversation_balance),
    communicationQuality: score(raw.communication_quality),
    relationshipTrend,
    progressionRisk: score(raw.progression_risk),
    overallReason, actionAdvice, signalsToObserve,
    keyMoments: [], timelineEvent: { shouldRecord: false },
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

module.exports = { normalizeReply, normalizeAnalysis, normalizeTimelineEvent };
