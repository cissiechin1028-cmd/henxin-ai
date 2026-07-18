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
  const options = raw.options.map((item) => ({
    tone: cleanString(item?.purpose, 24, true),
    text: cleanReplyText(item?.text, locale),
  }));
  const recommendedIndex = { option_1: 0, option_2: 1, option_3: 2 }[raw?.recommendedOption];
  if (!Number.isInteger(recommendedIndex)) throw new Error("AI_INVALID_RESULT");
  const recommended = options[recommendedIndex];
  const alternatives = options.filter((_, index) => index !== recommendedIndex);
  const currentState = cleanString(raw.currentState, 300, true);
  const rationale = cleanString(raw.overallRationale, 700, true);
  return {
    kind: "reply", conversationTemperature: score(raw.conversationTemperature), currentState,
    temperatureReason: currentState, recommendedReply: recommended.text, recommendedPurpose: recommended.tone,
    alternatives, reason: rationale, overallRationale: rationale, caution: cleanString(raw.caution, 300),
    conversationRead: currentState,
  };
}

function normalizeAnalysis(raw) {
  const trend = ["rising", "stable", "falling", "unclear"].includes(raw?.relationshipTrend)
    ? raw.relationshipTrend : (() => { throw new Error("AI_INVALID_TREND"); })();
  if (!Array.isArray(raw?.actions) || raw.actions.length !== 3) throw new Error("AI_INVALID_RESULT");
  const confidence = ["low", "medium", "high"].includes(raw?.confidence) ? raw.confidence : "low";
  return {
    kind: "analysis", affection: score(raw.affection), intentConsistency: score(raw.intentConsistency),
    relationshipTrend: trend, progressRisk: score(raw.progressRisk), confidence,
    scoreReasons: {
      affection: cleanString(raw.scoreReasons?.affection, 400, true),
      intentConsistency: cleanString(raw.scoreReasons?.intentConsistency, 400, true),
      relationshipTrend: cleanString(raw.scoreReasons?.relationshipTrend, 400, true),
      progressRisk: cleanString(raw.scoreReasons?.progressRisk, 400, true),
    },
    summary: cleanString(raw.headline, 160, true),
    whatCanBeConfirmed: cleanString(raw.whatCanBeConfirmed, 500, true),
    whatCannotBeConfirmed: cleanString(raw.whatCannotBeConfirmed, 500, true),
    evidence: Array.isArray(raw.evidence) ? raw.evidence.slice(0, 4).map((item) => cleanString(item, 300)).filter(Boolean) : [],
    overallReason: cleanString(raw.conclusion, 800, true),
    currentPsychology: cleanString(raw.whatCannotBeConfirmed, 500, true),
    actions: raw.actions.map((item) => cleanString(item, 300, true)),
    nextBestMove: cleanString(raw.nextBestMove, 300, true),
    signalToObserve: cleanString(raw.signalToObserve, 300, true),
    keyMoments: [], timelineEvent: { shouldRecord: false },
  };
}

function normalizeTimelineEvent(raw) {
  if (!raw?.shouldRecord || raw.evidenceStrength !== "clear") return { shouldRecord: false };
  const eventDate = raw.eventDate && /^\d{4}-\d{2}-\d{2}$/.test(raw.eventDate) ? raw.eventDate : null;
  return {
    shouldRecord: true, eventType: cleanString(raw.eventType, 64, true),
    title: cleanString(raw.title, 120, true), note: cleanString(raw.note, 1000), eventDate,
  };
}

module.exports = { normalizeReply, normalizeAnalysis, normalizeTimelineEvent };
