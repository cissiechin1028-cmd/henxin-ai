const crypto = require("crypto");
const { SCORE_VERSION, FEATURE_VERSION, clampScore } = require("./fiveDimensionScoring");
const { selectAnalysisWindow, WINDOW_VERSION } = require("./analysisWindow");

const DIMENSION_KEYS = ["topic_compatibility", "tempo_compatibility", "interaction_balance", "intimacy", "excitement"];

function normalizedText(value) {
  return String(value || "").normalize("NFKC").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();
}

function normalizedTimestamp(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : raw;
}

function canonicalMessage(message) {
  return { sender: message.sender, text: normalizedText(message.text), timestamp: normalizedTimestamp(message.timestamp) };
}

function ratioBalance(left, right, emptyValue = 0.5) {
  const total = left + right;
  return total > 0 ? 1 - Math.abs(left - right) / total : emptyValue;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function charBigrams(value) {
  const compact = normalizedText(value).toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
  const grams = new Set();
  for (let index = 0; index < compact.length - 1; index += 1) grams.add(compact.slice(index, index + 2));
  return grams;
}

function overlap(left, right) {
  const a = charBigrams(left), b = charBigrams(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return shared / Math.max(1, Math.min(a.size, b.size));
}

function density(messages, pattern) {
  return messages.filter(message => pattern.test(message.text)).length / Math.max(1, messages.length);
}

function calculateDeterministicDimensions(messages) {
  const self = messages.filter(message => message.sender === "self");
  const partner = messages.filter(message => message.sender === "partner");
  const transitions = messages.slice(1).map((message, index) => ({ previous: messages[index], current: message }));
  const alternating = transitions.filter(item => item.previous.sender !== item.current.sender);
  const alternationRate = alternating.length / Math.max(1, transitions.length);
  const lexicalContinuity = alternating.length
    ? alternating.reduce((sum, item) => sum + overlap(item.previous.text, item.current.text), 0) / alternating.length
    : 0;
  const questions = group => group.filter(message => /[?？]/u.test(message.text)).length;
  const selfQuestions = questions(self), partnerQuestions = questions(partner);
  const selfChars = self.reduce((sum, item) => sum + Array.from(item.text).length, 0);
  const partnerChars = partner.reduce((sum, item) => sum + Array.from(item.text).length, 0);
  const selfMedian = median(self.map(item => Array.from(item.text).length));
  const partnerMedian = median(partner.map(item => Array.from(item.text).length));
  const questionBalance = ratioBalance(selfQuestions, partnerQuestions);
  const questionPresence = Math.min(1, (selfQuestions + partnerQuestions) / Math.max(2, messages.length * 0.3));
  const datedTransitions = alternating.map(item => {
    const from = Date.parse(item.previous.timestamp || ""), to = Date.parse(item.current.timestamp || "");
    return Number.isFinite(from) && Number.isFinite(to) && to >= from ? { sender: item.current.sender, gap: to - from } : null;
  }).filter(Boolean);
  const selfGaps = datedTransitions.filter(item => item.sender === "self").map(item => item.gap);
  const partnerGaps = datedTransitions.filter(item => item.sender === "partner").map(item => item.gap);
  const timingBalance = selfGaps.length && partnerGaps.length ? ratioBalance(median(selfGaps), median(partnerGaps)) : null;
  const warmth = /ありがとう|ありがと|嬉し|楽しか|大丈夫|おつかれ|好き|かわい|哈哈|謝謝|開心|辛苦|喜歡|可愛|thanks|thank you|glad|happy|care|miss you|love|🙂|😊|🥰|❤|💕/iu;
  const disclosure = /私|僕|俺|わたし|気持ち|思って|感じ|其實|我覺得|我的|心情|i feel|i think|for me|my /iu;
  const expressive = /[!！~〜～]|笑|w{1,3}|哈哈|呵呵|lol|haha|[\u{1F300}-\u{1FAFF}]/iu;
  const mutualWarmth = Math.min(density(self, warmth), density(partner, warmth));
  const mutualDisclosure = Math.min(density(self, disclosure), density(partner, disclosure));
  const expressiveDensity = density(messages, expressive);
  const twoSided = self.length > 0 && partner.length > 0 ? 1 : 0;

  let dimensions = {
    topic_compatibility: clampScore(28 + 38 * alternationRate + 18 * Math.min(1, lexicalContinuity * 3) + 16 * questionPresence),
    tempo_compatibility: clampScore(30 + 30 * ratioBalance(selfMedian, partnerMedian) + 22 * alternationRate + 18 * (timingBalance ?? 0.5)),
    interaction_balance: clampScore(20 + 38 * ratioBalance(self.length, partner.length) + 24 * ratioBalance(selfChars, partnerChars) + 18 * questionBalance),
    intimacy: clampScore(32 + 26 * mutualWarmth + 20 * mutualDisclosure + 12 * ratioBalance(selfChars, partnerChars) + 10 * alternationRate),
    excitement: clampScore(24 + 28 * alternationRate + 18 * questionPresence + 18 * Math.min(1, expressiveDensity * 3) + 12 * twoSided),
  };

  // Small windows are useful, but should not manufacture extreme precision.
  const confidence = Math.min(1, messages.length / 20);
  if (confidence < 1) {
    dimensions = Object.fromEntries(DIMENSION_KEYS.map(key => [key, clampScore(50 + (dimensions[key] - 50) * (0.45 + confidence * 0.55))]));
  }
  return dimensions;
}

function prepareDeterministicAnalysis(messages = []) {
  const window = selectAnalysisWindow(messages);
  const recent = window.recent.map(canonicalMessage);
  const baseline = window.baseline.map(canonicalMessage);
  const scoringMessages = [...baseline, ...recent];
  const dimensions = calculateDeterministicDimensions(scoringMessages);
  const fingerprintPayload = {
    score_version: SCORE_VERSION,
    feature_version: FEATURE_VERSION,
    window_version: WINDOW_VERSION,
    participant_mapping: ["self", "partner"],
    baseline,
    recent,
  };
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify(fingerprintPayload)).digest("hex");
  return { window, recent, baseline, scoringMessages, dimensions, fingerprint };
}

module.exports = { DIMENSION_KEYS, normalizedText, normalizedTimestamp, calculateDeterministicDimensions, prepareDeterministicAnalysis };
