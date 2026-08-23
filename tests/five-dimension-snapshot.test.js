const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const{calculateOverallScore,SCORE_VERSION,ANALYSIS_VERSION}=require("../services/fiveDimensionScoring");
const{selectAnalysisWindow}=require("../services/analysisWindow");

test("versioned weighted overall score is business logic",()=>{
 assert.equal(SCORE_VERSION,"five_dimension_v1");assert.equal(ANALYSIS_VERSION,3);
 assert.equal(calculateOverallScore({topic_compatibility:100,tempo_compatibility:0,interaction_balance:100,intimacy:0,excitement:100}),60);
 assert.equal(calculateOverallScore({topic_compatibility:120,tempo_compatibility:-5,interaction_balance:50,intimacy:50,excitement:50}),53);
});

test("recent window prioritizes current messages and keeps a compact baseline",()=>{
 const start=Date.parse("2025-01-01T00:00:00Z"),messages=Array.from({length:240},(_,index)=>({sender:index%2?"self":"partner",text:`m${index}`,timestamp:new Date(start+index*86400000).toISOString()}));
 const window=selectAnalysisWindow(messages);
 assert.equal(window.metadata.recent_weight,.8);assert.equal(window.metadata.baseline_weight,.2);
 assert.ok(window.recent.length<=120);assert.ok(window.baseline.length<=30);assert.ok(window.recent.every(item=>Number(item.text.slice(1))>=209));
});

test("missing timestamps degrade to the latest message window",()=>{
 const window=selectAnalysisWindow(Array.from({length:140},(_,index)=>({sender:index%2?"self":"partner",text:`m${index}`})));
 assert.equal(window.metadata.strategy,"latest_120_messages_plus_baseline");assert.equal(window.recent.length,120);assert.equal(window.metadata.timestamp_coverage,0);
});

test("snapshot API and append-only migration are relationship and owner scoped",()=>{
 const app=fs.readFileSync(path.join(__dirname,"..","webApp.js"),"utf8"),migration=fs.readFileSync(path.join(__dirname,"..","migrations","20260823_relationship_analysis_snapshots.sql"),"utf8");
 assert.match(app,/analysis-snapshots/);assert.match(app,/\.eq\("user_id",req\.user\.id\)\.eq\("relationship_id",resolved\.data\.id\)/);
 assert.match(migration,/unique references public\.analyses/);assert.match(migration,/relationship_analysis_snapshots_relationship_created_idx/);assert.doesNotMatch(migration,/create policy[^;]+for update/is);
});
