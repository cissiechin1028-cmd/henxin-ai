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
  assert.match(reply, /Do not produce a long relationship analysis/);
  assert.match(analysis, /Do not produce ready-to-send reply candidates/);
  assert.match(event, /Do not analyse the whole relationship/);
  assert.match(report, /Do not create reply proposals/);
});

test("locale rules are independently selected", () => {
  assert.match(replyProposalPrompt("ja", {}), /natural contemporary Japanese/);
  assert.match(replyProposalPrompt("zh-TW", {}), /台灣繁體中文/);
  assert.match(replyProposalPrompt("en", {}), /natural English/);
});

test("normalizers reject mixed-language user-facing output", () => {
  const baseReply = {
    conversationTemperature: 60,
    currentState: "会話は自然に続いています。",
    options: [
      { strategy: "option_1", text: "そうなんだね。", reason: "自然な返信です。" },
      { strategy: "option_2", text: "今度会わない？", reason: "少し温かさを出せる返信です。" },
      { strategy: "option_3", text: "教えてくれてありがとう。", reason: "圧をかけずに返せます。" },
    ],
  };
  assert.throws(() => normalizeReply({ ...baseReply, options: [{ ...baseReply.options[0], text: "這樣很好呀。" }, ...baseReply.options.slice(1)] }, "ja"), /AI_LANGUAGE_MISMATCH/);
  assert.throws(() => normalizeReply({ ...baseReply, options: [{ ...baseReply.options[0], text: "今度の約会を楽しみにしています。" }, ...baseReply.options.slice(1)] }, "ja"), /AI_LANGUAGE_MISMATCH/);
  assert.throws(() => normalizeReply({ ...baseReply, currentState: "The conversation is continuing.", options: baseReply.options.map((item, index) => ({ ...item, text: ["Sure.", "そうなんだね。", "Thank you."][index], reason: "This is natural." })) }, "en"), /AI_LANGUAGE_MISMATCH/);
  assert.throws(() => normalizeAnalysis({ topic_compatibility: 50, tempo_compatibility: 50, interaction_balance: 50, intimacy: 50, excitement: 50, dimension_reasons: {topic_compatibility:"話題を拾っています。",tempo_compatibility:"テンポは自然です。",interaction_balance:"双方が話しています。",intimacy:"親しさがあります。",excitement:"反応があります。"}, dimension_summary: {topic_compatibility:"話題を自然に拾っています。",tempo_compatibility:"テンポは安定しています。",interaction_balance:"双方が会話に参加しています。",intimacy:"親しさが見えています。",excitement:"反応が続いています。"}, core_reason: "目前還需要觀察。", action_advice: "焦らず待ちましょう。", signals_to_observe: ["對方是否主動"] }, "zh-TW"), /AI_LANGUAGE_MISMATCH/);
});

test("reply prompt may recommend no further message after a natural ending", () => {
  const prompt = replyProposalPrompt("ja", {});
  assert.match(prompt, /visible conversation has already ended naturally/);
  assert.match(prompt, /no further reply needed/);
});

test("reply prompt uses relationship goal style architecture without legacy strategy modes", () => {
  const prompt = replyProposalPrompt("ja", { relationshipStatus: "in_contact", replyGoal: "lead_to_date", replyStyle: "amaeru" });
  assert.match(prompt, /USER INPUT DIMENSIONS/);
  assert.match(prompt, /amaeru/);
  assert.match(prompt, /Validation Criteria/);
  assert.match(prompt, /OPENING DIVERSITY RULE/);
  assert.match(prompt, /忙しいと思うけど/);
  assert.doesNotMatch(prompt, /assertive|cautious|recommended/i);
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

test("reply output requires the three v2 candidate slots", () => {
  const value = normalizeReply({
    conversationTemperature: 64,
    currentState: "会話は続いているが、相手の積極性までは確認できない。",
    options: [
      { strategy: "option_1", text: "そうなんだ、最近はどう？", reason: "相手の温度感に自然に合わせられる返信です。" },
      { strategy: "option_2", text: "今度会ってゆっくり話さない？", reason: "目的に沿って少し踏み込める返信です。" },
      { strategy: "option_3", text: "教えてくれてありがとう。", reason: "相手に圧をかけず今の関係を保てます。" }
    ]
  });
  assert.equal(value.recommendedReply, "そうなんだ、最近はどう？");
  assert.equal(value.alternatives.length, 2);
  assert.equal(value.recommendedReason, "相手の温度感に自然に合わせられる返信です。");
  assert.equal(value.alternatives[0].strategy, "option_2");
});

test("reply output rejects missing options and invalid scores", () => {
  assert.throws(() => normalizeReply({ options: [] }), /AI_INVALID_RESULT/);
  assert.throws(() => normalizeReply({
    conversationTemperature: 120, currentState: "判断材料は限られる。",
    options: [{ strategy: "option_1", text: "そうですね。", reason: "自然です。" }, { strategy: "option_2", text: "また話そう。", reason: "自然です。" }, { strategy: "option_3", text: "教えてくれてありがとう。", reason: "自然です。" }]
  }), /AI_INVALID_SCORE/);
});

test("reply output rejects exact duplicate replies", () => {
  assert.throws(() => normalizeReply({
    conversationTemperature: 50, currentState: "会話は自然に続いています。",
    options: [
      { strategy: "option_1", text: "そうなんだね。", reason: "自然です。" },
      { strategy: "option_2", text: "そうなんだね。", reason: "自然です。" },
      { strategy: "option_3", text: "教えてくれてありがとう。", reason: "自然です。" }
    ]
  }, "ja"), /AI_DUPLICATE_REPLIES/);
});

test("reply output enforces locale-aware safety length ceilings", () => {
  assert.throws(() => normalizeReply({
    conversationTemperature: 50, currentState: "判断材料は限られる。",
    options: [
      { strategy: "option_1", text: "あ".repeat(121), reason: "自然です。" },
      { strategy: "option_2", text: "そうなんだね。", reason: "自然です。" },
      { strategy: "option_3", text: "教えてくれてありがとう。", reason: "自然です。" }
    ]
  }, "ja"), /AI_REPLY_TOO_LONG/);
});

test("analysis returns five evidence-based dimensions and a deterministic overall score", () => {
  const value = normalizeAnalysis({
    topic_compatibility: 88, tempo_compatibility: 72, interaction_balance: 81, intimacy: 65, excitement: 74,
    dimension_reasons: {topic_compatibility:"話題を自然に拾い合っています。",tempo_compatibility:"無理のない順番で返しています。",interaction_balance:"双方から質問があります。",intimacy:"具体的な気持ちを伝えています。",excitement:"会話を続ける反応があります。"},
    dimension_summary: {topic_compatibility:"互いの話題を自然に受け取り、質問や補足を重ねながら会話を広げられています。共通の関心だけに頼らず、相手の発言を次の話題につなげる流れが安定しています。",tempo_compatibility:"返信の順番や文章量はおおむね噛み合い、無理なく会話が進んでいます。間の取り方にわずかな差はありますが、流れを大きく崩すほどではありません。",interaction_balance:"質問、返答、話題の持ち込みが一方だけに偏らず、双方が会話を支えています。場面によって片方が少し長く話すことはありますが、全体では釣り合っています。",intimacy:"日常の具体的な出来事や気持ちを少しずつ共有できており、安心感のある距離に近づいています。ただし、深い本音の共有はまだ限定的です。",excitement:"相手の発言への明るい反応や話題を続ける動きがあり、会話には前向きな勢いがあります。常に高い熱量というより、自然に続く楽しさが中心です。"},
    core_reason: "会話は成立していますが、関係変化を示す比較材料はまだ限られます。",
    action_advice: "今は自然に一度返し、相手が話題を広げるか見てください。",
    signals_to_observe: ["相手から質問が出るか", "具体的な提案が出るか"]
  });
  assert.equal(value.analysisVersion, 3);
  assert.equal(value.scoreVersion, "five_dimension_v1");
  assert.equal(value.overallScore, 76);
  assert.deepEqual(value.dimensions, {topic_compatibility:88,tempo_compatibility:72,interaction_balance:81,intimacy:65,excitement:74});
  assert.equal(value.dimensionReasons.topic_compatibility, "話題を自然に拾い合っています。");
  assert.match(value.dimensionSummaries.topic_compatibility, /相手の発言を次の話題/);
  assert.equal(value.signalsToObserve.length, 2);
});

test("analysis rejects missing or invalid five-dimensional scores",()=>{
 assert.throws(()=>normalizeAnalysis({topic_compatibility:101,tempo_compatibility:50,interaction_balance:50,intimacy:50,excitement:50,dimension_reasons:{},core_reason:"判断材料があります。",action_advice:"様子を見ます。",signals_to_observe:["反応を見る"]}),/AI_INVALID_SCORE/);
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
