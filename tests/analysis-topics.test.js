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

test("saved conversations can request base five-dimensional analysis without a topic",()=>{
 const appSource=fs.readFileSync(path.join(__dirname,"..","webApp.js"),"utf8");
 const serviceSource=fs.readFileSync(path.join(__dirname,"..","services","webAnalysis.js"),"utf8");
 assert.match(appSource,/topicId\?getAnalysisTopic\(topicId\):null/);
 assert.match(appSource,/analyzeConversationBaseForWeb/);
 assert.match(serviceSource,/async function analyzeConversationBaseForWeb/);
 assert.match(serviceSource,/chatAnalysisPrompt\(locale,\{\.\.\.context,dataWindow:window\.metadata\}\)/);
 assert.match(serviceSource,/schema:chatAnalysisSchema/);
});

test("topic analysis keeps server-owned identifiers authoritative", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "services", "webAnalysis.js"), "utf8");
  const topicAnalysis = source.slice(source.indexOf("async function analyzeConversationTopicForWeb"), source.indexOf("async function analyzeForWeb"));
  assert.doesNotMatch(topicAnalysis, /raw\.topic_id\s*!==\s*context\.topicId/);
  assert.match(topicAnalysis, /topic_id:context\.topicId/);
  assert.match(topicAnalysis, /readiness_status:context\.readinessStatus/);
  assert.match(topicAnalysis, /reasoningEffort:"low"/);
  assert.match(topicAnalysis, /validateTopicDepth/);
});

test("dating safety check performs cautious longitudinal pattern analysis", () => {
  const promptSource = fs.readFileSync(path.join(__dirname, "..", "prompts", "topicAnalysis.js"), "utf8");
  const topic = getAnalysisTopic("dating-safety");
  assert.ok(topic);
  assert.match(topic.evidenceInstruction, /返信の遅さ・短さ・冷淡さ/);
  assert.match(topic.evidenceInstruction, /通常のLINE交換/);
  assert.match(topic.evidenceInstruction, /一度の動画通話拒否/);
  assert.match(promptSource, /False positives are a primary product harm/);
  assert.match(promptSource, /Reconstruct the conversation chronologically/);
  assert.match(promptSource, /Compare repeated claims across time/);
  assert.match(promptSource, /Trace meaningful topic migration/);
  assert.match(promptSource, /Trace request escalation across turns/);
  assert.match(promptSource, /persistent avoidance/);
  assert.match(promptSource, /answer responsiveness/);
  assert.match(promptSource, /Run a counter-evidence check/);
  assert.match(promptSource, /overall_interaction, relationship_timeline, consistency_check/);
  assert.match(promptSource, /checked_points as a compact auxiliary module/);
  assert.match(promptSource, /Never open or investigate URLs/);
});
