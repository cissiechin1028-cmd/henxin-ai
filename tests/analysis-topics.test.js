const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ANALYSIS_TOPICS, getAnalysisTopic } = require("../analysisTopics");

test("server owns all sixteen diagnoses plus the independent safety check", () => {
  assert.equal(ANALYSIS_TOPICS.length, 17);
  assert.equal(new Set(ANALYSIS_TOPICS.map((topic) => topic.id)).size, 17);
  for (const topic of ANALYSIS_TOPICS) {
    assert.ok(topic.title);
    assert.ok(topic.question);
    assert.ok(topic.evidenceInstruction);
    assert.ok(topic.requiredModules.length >= 4);
    assert.equal(getAnalysisTopic(topic.id), topic);
  }
});

test("unknown topic ids are rejected by the resolver", () => {
  assert.equal(getAnalysisTopic("not-a-real-topic"), null);
  assert.equal(getAnalysisTopic(""), null);
});

test("conversation analysis route never trusts a client topic contract", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "webApp.js"), "utf8");
  const route = source.slice(source.indexOf('app.post("/api/v1/anonymous/conversation-analyses"'), source.indexOf('app.get("/api/v1/analyses"'));
  assert.match(route, /getAnalysisTopic\(topicId\)/);
  assert.doesNotMatch(route, /req\.body\?\.topic\b/);
  assert.doesNotMatch(route, /evidenceInstruction:\s*req\.body/);
  assert.doesNotMatch(route, /requiredModules:\s*req\.body/);
});

test("topic analysis keeps server-owned identifiers authoritative", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "services", "webAnalysis.js"), "utf8");
  const topicAnalysis = source.slice(source.indexOf("async function analyzeConversationTopicForWeb"), source.indexOf("async function analyzeForWeb"));
  assert.doesNotMatch(topicAnalysis, /raw\.topic_id\s*!==\s*context\.topicId/);
  assert.match(topicAnalysis, /topic_id:context\.topicId/);
  assert.match(topicAnalysis, /readiness_status:context\.readinessStatus/);
  assert.match(topicAnalysis, /reasoningEffort:"minimal"/);
});

test("dating safety check prioritizes false-positive control", () => {
  const promptSource = fs.readFileSync(path.join(__dirname, "..", "prompts", "topicAnalysis.js"), "utf8");
  const topic = getAnalysisTopic("dating-safety");
  assert.ok(topic);
  assert.match(topic.evidenceInstruction, /返信の遅さ・短さ・冷淡さ/);
  assert.match(topic.evidenceInstruction, /通常のLINE交換/);
  assert.match(topic.evidenceInstruction, /一度の動画通話拒否/);
  assert.match(promptSource, /False positives are the primary product harm/);
  assert.match(promptSource, /money\/investment requests/);
  assert.match(promptSource, /verification codes/);
  assert.match(promptSource, /zero risk evidence/);
  assert.match(promptSource, /Do not open or investigate URLs/);
});
