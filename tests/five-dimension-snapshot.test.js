const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const{calculateOverallScore,SCORE_VERSION,FEATURE_VERSION,ANALYSIS_VERSION}=require("../services/fiveDimensionScoring");
const{selectAnalysisWindow}=require("../services/analysisWindow");
const{prepareDeterministicAnalysis}=require("../services/deterministicFiveDimension");
const{normalizeAnalysis}=require("../services/resultNormalizers");

test("versioned weighted overall score is business logic",()=>{
 assert.equal(SCORE_VERSION,"five_dimension_v2_deterministic");assert.equal(FEATURE_VERSION,"deterministic_chat_features_v1");assert.equal(ANALYSIS_VERSION,3);
 assert.equal(calculateOverallScore({topic_compatibility:100,tempo_compatibility:0,interaction_balance:100,intimacy:0,excitement:100}),60);
 assert.equal(calculateOverallScore({topic_compatibility:120,tempo_compatibility:-5,interaction_balance:50,intimacy:50,excitement:50}),53);
});

const realMessages=()=>[
 {sender:"self",text:"今日おつかれ！",timestamp:"2026-08-30T10:00:00+09:00"},
 {sender:"partner",text:"ありがとう、そっちもおつかれ😊",timestamp:"2026-08-30T10:02:00+09:00"},
 {sender:"self",text:"週末カフェ行かない？",timestamp:"2026-08-30T10:04:00+09:00"},
 {sender:"partner",text:"いいね、どのカフェ？",timestamp:"2026-08-30T10:05:00+09:00"},
];

test("identical normalized scoring input has one fingerprint and one set of five dimensions",()=>{
 const first=prepareDeterministicAnalysis(realMessages()),second=prepareDeterministicAnalysis(realMessages().map(item=>({...item,text:` ${item.text} `})));
 assert.equal(first.fingerprint,second.fingerprint);
 assert.deepEqual(first.dimensions,second.dimensions);
 const changed=prepareDeterministicAnalysis(realMessages().map((item,index)=>index===0?{...item,sender:"partner"}:item));
 assert.notEqual(changed.fingerprint,first.fingerprint);
});

test("model score sampling cannot change authoritative Layer 01 scores",()=>{
 const prepared=prepareDeterministicAnalysis(realMessages());
 const raw=(value)=>({topic_compatibility:value,tempo_compatibility:value,interaction_balance:value,intimacy:value,excitement:value,dimension_reasons:{topic_compatibility:"話題を互いに受け取っています。",tempo_compatibility:"短い間隔で自然に返しています。",interaction_balance:"双方から発言があります。",intimacy:"労いの言葉が見えます。",excitement:"質問で会話が続いています。"},dimension_summary:{topic_compatibility:"日常の話から週末の予定へ、互いに内容を受け取りながら話題を広げています。",tempo_compatibility:"短い間隔の往復が続き、双方のメッセージの長さも大きく離れていません。",interaction_balance:"どちらか一方だけでなく、双方が発言と質問を返して会話を作っています。",intimacy:"互いを労う言葉があり、現在のやりとりには穏やかな近さが表れています。",excitement:"提案に質問が返り、次の話へつながる会話の動きが現在見えています。"},core_reason:"互いに質問を返して会話を続けています。",action_advice:"今の話題を一つだけ具体化してください。",signals_to_observe:["相手から具体的な候補が返るかを見る。"],timelineEvent:{shouldRecord:false,eventType:"custom",title:"",aiSummary:"",eventDate:null,evidenceStrength:"insufficient"}});
 const options={dataWindow:prepared.window.metadata,authoritativeDimensions:prepared.dimensions,inputFingerprint:prepared.fingerprint};
 const low=normalizeAnalysis(raw(1),"ja",options),high=normalizeAnalysis(raw(99),"ja",options);
 assert.deepEqual(low.dimensions,high.dimensions);assert.equal(low.overallScore,high.overallScore);assert.equal(low.inputFingerprint,prepared.fingerprint);
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

test("duplicate base analyses reuse a fingerprint and result deletion is relationship scoped",()=>{
 const app=fs.readFileSync(path.join(__dirname,"..","webApp.js"),"utf8"),migration=fs.readFileSync(path.join(__dirname,"..","migrations","20260901_deterministic_analysis_fingerprint.sql"),"utf8");
 assert.match(app,/analysis_fingerprint:preparedBase\.fingerprint/);assert.match(app,/reused:true/);
 assert.match(app,/app\.delete\("\/api\/v1\/relationships\/:relationshipId\/analysis-snapshots\/:resultId"/);
 assert.match(app,/timeline_events/);assert.match(app,/supabase\.from\("analyses"\)\.delete\(\)/);
 assert.match(migration,/analyses_base_fingerprint_locale_unique/);assert.match(migration,/input_metadata->>'locale'/);
});
