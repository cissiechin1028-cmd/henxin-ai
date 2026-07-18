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

test("reply output requires exactly three distinct-purpose options", () => {
  const value = normalizeReply({
    conversationTemperature: 64,
    currentState: "会話は続いているが、相手の積極性までは確認できない。",
    options: [
      { purpose: "自然に続ける", text: "そうなんだ、最近はどう？" },
      { purpose: "少し様子を見る", text: "教えてくれてありがとう。" },
      { purpose: "境界を伝える", text: "今は少し考える時間がほしいな。" }
    ],
    recommendedOption: "option_1",
    overallRationale: "相手が話題に応じているため、まず会話を自然に続ける案が合う。",
    caution: ""
  });
  assert.equal(value.recommendedReply, "そうなんだ、最近はどう？");
  assert.equal(value.alternatives.length, 2);
  assert.equal(value.reason, value.overallRationale);
});

test("reply output rejects missing options and invalid scores", () => {
  assert.throws(() => normalizeReply({ options: [] }), /AI_INVALID_RESULT/);
  assert.throws(() => normalizeReply({
    conversationTemperature: 120, currentState: "x",
    options: [{ purpose: "a", text: "a" }, { purpose: "b", text: "b" }, { purpose: "c", text: "c" }],
    recommendedOption: "option_1", overallRationale: "x", caution: ""
  }), /AI_INVALID_SCORE/);
});

test("reply output enforces locale-aware safety length ceilings", () => {
  assert.throws(() => normalizeReply({
    conversationTemperature: 50, currentState: "判断材料は限られる。",
    options: [
      { purpose: "自然に続ける", text: "あ".repeat(121) },
      { purpose: "確認する", text: "そうなんだね。" },
      { purpose: "待つ", text: "教えてくれてありがとう。" }
    ],
    recommendedOption: "option_1", overallRationale: "現在の会話に合わせた。", caution: ""
  }, "ja"), /AI_REPLY_TOO_LONG/);
});

test("analysis supports explicit uncertainty without inventing a trend", () => {
  const value = normalizeAnalysis({
    affection: 50, intentConsistency: 50, relationshipTrend: "unclear", progressRisk: 50,
    confidence: "low",
    scoreReasons: { affection: "材料不足", intentConsistency: "材料不足", relationshipTrend: "比較材料がない", progressRisk: "判断材料が限られる" },
    headline: "現時点では判断材料が限られる",
    whatCanBeConfirmed: "短いやり取りがある。",
    whatCannotBeConfirmed: "好意や今後の意図は確認できない。",
    evidence: ["会話が短い"], conclusion: "追加のやり取りを見る必要がある。",
    actions: ["一度だけ自然に返す", "返答内容を観察する", "追いかけて送らない"],
    nextBestMove: "一度だけ自然に返し、相手が話題を広げるかを見る。",
    signalToObserve: "相手から質問や具体的な提案が出るか"
  });
  assert.equal(value.relationshipTrend, "unclear");
  assert.equal(value.confidence, "low");
  assert.equal(value.actions.length, 3);
});

test("timeline records only clear significant events", () => {
  assert.deepEqual(normalizeTimelineEvent({ shouldRecord: true, evidenceStrength: "insufficient" }), { shouldRecord: false });
  const event = normalizeTimelineEvent({
    shouldRecord: true, evidenceStrength: "clear", eventType: "relationship_confirmed",
    title: "交際することを確認した", note: "双方が交際を明確に確認した。", eventDate: "2026-07-18"
  });
  assert.equal(event.shouldRecord, true);
  assert.equal(event.eventDate, "2026-07-18");
});
