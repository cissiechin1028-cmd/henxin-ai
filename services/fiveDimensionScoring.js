const SCORE_VERSION = "five_dimension_v2_deterministic";
const FEATURE_VERSION = "deterministic_chat_features_v1";
const ANALYSIS_VERSION = 3;
const SCORE_WEIGHTS = Object.freeze({
  topic_compatibility: 0.20,
  tempo_compatibility: 0.15,
  interaction_balance: 0.20,
  intimacy: 0.25,
  excitement: 0.20,
});

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("AI_INVALID_SCORE");
  return Math.max(0, Math.min(100, Math.round(number)));
}

function calculateOverallScore(dimensions) {
  const total = Object.entries(SCORE_WEIGHTS).reduce((sum, [key, weight]) => sum + clampScore(dimensions[key]) * weight, 0);
  return clampScore(total);
}

module.exports = { SCORE_VERSION, FEATURE_VERSION, ANALYSIS_VERSION, SCORE_WEIGHTS, clampScore, calculateOverallScore };
