const test = require("node:test");
const assert = require("node:assert/strict");
const { replyProposalPrompt } = require("../prompts/replyProposal");
const { chatAnalysisPrompt } = require("../prompts/chatAnalysis");
const { relationshipEventPrompt } = require("../prompts/relationshipEvent");
const { relationshipReportSystemPrompt } = require("../prompts/relationshipReport");
const { buildContext } = require("../prompts/context");
const { normalizeReply, normalizeAnalysis, normalizeTimelineEvent } = require("../services/resultNormalizers");

const scenarios = [
  "ambiguous", "new_relationship", "long_term_relationship", "coldness", "argument",
  "read_without_reply", "insufficient_information", "emotional_user", "advance_relationship", "set_boundary"
];

test("quality scenario matrix covers required product situations", () => {
  assert.deepEqual(scenarios, [
    "ambiguous", "new_relationship", "long_term_relationship", "coldness", "argument",
    "read_without_reply", "insufficient_information", "emotional_user", "advance_relationship", "set_boundary"
  ]);
});

test("module prompts have separate responsibilities", () => {
  const reply = replyProposalPrompt("ja", {});
  const analysis = chatAnalysisPrompt("ja", {});
  const event = relationshipEventPrompt("ja");
  const report = relationshipReportSystemPrompt("ja");
  assert.match(reply, /What should the user reply now/);
  assert.match(reply, /Do not provide a long relationship analysis/);
  assert.match(analysis, /Do not produce ready-to-send reply candidates/);
  assert.match(event, /Do not analyse the whole relationship/);
  assert.match(report, /Do not create reply proposals/);
});

test("locale rules are independently selected", () => {
  assert.match(replyProposalPrompt("ja", {}), /natural contemporary Japanese/);
  assert.match(replyProposalPrompt("zh-TW", {}), /台灣繁體中文/);
  assert.match(replyProposalPrompt("en", {}), /natural English/);
});

test("reply prompt may recommend no further message after a natural ending", () => {
  const prompt = replyProposalPrompt("ja", {});
  assert.match(prompt, /natural, mutually understood ending/);
  assert.match(prompt, /ending the exchange without another reply/);
});

test("context separates user facts, saved events, and prior AI interpretation", () => {
  const text = buildContext({
    userGoal: "set a boundary",
    recentEvents: [{ date: "2026-07-10", title: "Confirmed the relationship", source: "user" }],
    priorAnalysis: "The exchange appeared warmer."
  });
  assert.match(text, /User-provided context/);
  assert.match(text, /Events saved within this same relationship/);
  assert.match(text, /not verified fact/);
  assert.match(text, /Current screenshot evidence takes priority/);
});

test("reply output requires the three fixed strategies", () => {
  const value = normalizeReply({
    conversationTemperature: 64,
    currentState: "会話は続いているが、相手の積極性までは確認できない。",
    options: [
      { strategy: "recommended", text: "そうなんだ、最近はどう？", reason: "相手の温度感に自然に合わせられる返信です。" },
      { strategy: "assertive", text: "今度会ってゆっくり話さない？", reason: "少し早く関係を進めたい場合の返信です。" },
      { strategy: "cautious", text: "教えてくれてありがとう。", reason: "相手に圧をかけず今の関係を保てます。" }
    ]
  });
  assert.equal(value.recommendedReply, "そうなんだ、最近はどう？");
  assert.equal(value.alternatives.length, 2);
  assert.equal(value.recommendedReason, "相手の温度感に自然に合わせられる返信です。");
  assert.equal(value.alternatives[0].strategy, "assertive");
});

test("reply output rejects missing options and invalid scores", () => {
  assert.throws(() => normalizeReply({ options: [] }), /AI_INVALID_RESULT/);
  assert.throws(() => normalizeReply({
    conversationTemperature: 120, currentState: "x",
    options: [{ strategy: "recommended", text: "a", reason: "a" }, { strategy: "assertive", text: "b", reason: "b" }, { strategy: "cautious", text: "c", reason: "c" }]
  }), /AI_INVALID_SCORE/);
});

test("reply output enforces locale-aware safety length ceilings", () => {
  assert.throws(() => normalizeReply({
    conversationTemperature: 50, currentState: "判断材料は限られる。",
    options: [
      { strategy: "recommended", text: "あ".repeat(121), reason: "自然です。" },
      { strategy: "assertive", text: "そうなんだね。", reason: "積極的です。" },
      { strategy: "cautious", text: "教えてくれてありがとう。", reason: "慎重です。" }
    ]
  }, "ja"), /AI_REPLY_TOO_LONG/);
});

test("analysis returns four internal metrics and concise guidance", () => {
  const value = normalizeAnalysis({
    conversation_balance: 50, communication_quality: 62, relationship_trend: 50, progression_risk: 55,
    core_reason: "会話は成立していますが、関係変化を示す比較材料はまだ限られます。",
    action_advice: "今は自然に一度返し、相手が話題を広げるか見てください。",
    signals_to_observe: ["相手から質問が出るか", "具体的な提案が出るか"]
  });
  assert.equal(value.relationshipTrend, 50);
  assert.equal(value.conversationBalance, 50);
  assert.equal(value.signalsToObserve.length, 2);
});

test("timeline records only clear significant events", () => {
  assert.deepEqual(normalizeTimelineEvent({ shouldRecord: true, evidenceStrength: "insufficient" }), { shouldRecord: false });
  const event = normalizeTimelineEvent({
    shouldRecord: true, evidenceStrength: "clear", eventType: "relationship_confirmed",
    title: "交際することを確認した", aiSummary: "関係は明確な交際段階へ進みました。", eventDate: "2026-07-18"
  });
  assert.equal(event.shouldRecord, true);
  assert.equal(event.eventDate, "2026-07-18");
  assert.equal(event.note, "関係は明確な交際段階へ進みました。");
});
