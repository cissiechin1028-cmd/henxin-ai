const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const server = fs.readFileSync(path.join(__dirname, "..", "webApp.js"), "utf8");
const analysisService = fs.readFileSync(path.join(__dirname, "..", "services", "webAnalysis.js"), "utf8");

test("anonymous auth does not fabricate a default relationship", () => {
  const requireUser = server.slice(server.indexOf("async function requireUser"), server.indexOf("async function requireAdmin"));
  assert.doesNotMatch(requireUser, /switch_relationship|RELATIONSHIP_BOOTSTRAP_FAILED/);
});

test("failed first analysis has an owned relationship delete contract", () => {
  assert.match(server, /app\.delete\("\/api\/v1\/relationships\/:relationshipId"/);
  assert.match(server, /RELATIONSHIP_ANALYSES_DELETE_FAILED/);
  assert.match(server, /RELATIONSHIP_DELETE_FAILED/);
});

test("base analysis is accepted without a topic and linked to the requested relationship", () => {
  const route = server.slice(server.indexOf('app.post("/api/v1/anonymous/conversation-analyses"'), server.indexOf('app.post("/api/v1/anonymous/strategies"'));
  assert.match(route, /topicId\?getAnalysisTopic\(topicId\):null/);
  assert.match(route, /analyzeConversationBaseForWeb/);
  assert.match(route, /req\.body\?\.relationshipId/);
  assert.match(route, /relationship_id:resolved\.data\.id/);
  assert.match(analysisService, /async function analyzeConversationBaseForWeb/);
  assert.match(analysisService, /chatAnalysisSchema/);
  assert.match(analysisService, /selectAnalysisWindow/);
  assert.match(analysisService, /dataWindow: window\.metadata/);
});

test("base analysis produces the snapshot-compatible five-dimension version", () => {
  const normalizer = fs.readFileSync(path.join(__dirname, "..", "services", "resultNormalizers.js"), "utf8");
  const scoring = fs.readFileSync(path.join(__dirname, "..", "services", "fiveDimensionScoring.js"), "utf8");
  assert.match(normalizer, /analysisVersion: ANALYSIS_VERSION/);
  assert.match(normalizer, /scoreVersion: SCORE_VERSION/);
  assert.match(normalizer, /overallScore/);
  assert.match(normalizer, /dimensions/);
  assert.match(scoring, /const ANALYSIS_VERSION = 3/);
});

test("completed relationship analysis can reopen through the snapshot route", () => {
  assert.match(server, /\/api\/v1\/relationships\/:relationshipId\/analysis-snapshots/);
  assert.match(server, /relationship_analysis_snapshots/);
  assert.match(server, /\.eq\("relationship_id", resolved\.data\.id\)/);
});
