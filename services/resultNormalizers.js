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
  return {
    kind: "reply", conversationTemperature: score(raw.conversationTemperature), currentState,
    temperatureReason: currentState, recommendedReply: recommended.text, recommendedPurpose: recommended.strategy,
    recommendedReason: recommended.reason, alternatives, reason: recommended.reason,
    conversationRead: currentState,
  };
}

function normalizeAnalysis(raw) {
  if (!Array.isArray(raw?.signals_to_observe) || raw.signals_to_observe.length < 1 || raw.signals_to_observe.length > 3) throw new Error("AI_INVALID_RESULT");
  const relationshipTrend = score(raw.relationship_trend);
  return {
    kind: "analysis",
    conversationBalance: score(raw.conversation_balance),
    communicationQuality: score(raw.communication_quality),
    relationshipTrend,
    progressionRisk: score(raw.progression_risk),
    overallReason: cleanString(raw.core_reason, 220, true),
    actionAdvice: cleanString(raw.action_advice, 220, true),
    signalsToObserve: raw.signals_to_observe.map((item) => cleanString(item, 160, true)),
    keyMoments: [], timelineEvent: { shouldRecord: false },
  };
}

function normalizeTimelineEvent(raw) {
  if (!raw?.shouldRecord || raw.evidenceStrength !== "clear") return { shouldRecord: false };
  const eventDate = raw.eventDate && /^\d{4}-\d{2}-\d{2}$/.test(raw.eventDate) ? raw.eventDate : null;
  return {
    shouldRecord: true, eventType: cleanString(raw.eventType, 64, true),
    title: cleanString(raw.title, 120, true), note: cleanString(raw.aiSummary, 220, true), eventDate,
  };
}

module.exports = { normalizeReply, normalizeAnalysis, normalizeTimelineEvent };
