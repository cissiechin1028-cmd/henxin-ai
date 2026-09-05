const crypto=require('crypto');
const {aiUsageProperties}=require('../tracking/cost');
const {assertLocale}=require('./resultNormalizers');
const {selectAnalysisWindow}=require('./analysisWindow');
const {VERSIONS,analysisSchema,finalCopySchema,validateAnalysis,validateFinalCopy,overlapChecks}=require('../schemas/premiumUnified');
const {analysisPrompt,finalPrompt}=require('../prompts/premiumUnified');
function selectedContext(messages){const window=selectAnalysisWindow(messages);const tag=m=>({id:'M'+crypto.createHash('sha256').update(JSON.stringify([m.sender,m.timestamp||null,m.text])).digest('hex').slice(0,16),sender:m.sender,text:m.text,timestamp:m.timestamp||null});return{baseline:window.baseline.map(tag),recent:window.recent.map(tag),metadata:window.metadata}}
async function modelCall({phase,prompt,input,schema}){
 if(!process.env.OPENAI_API_KEY)throw new Error('OPENAI_NOT_CONFIGURED');
 const model=phase==='analysis'?(process.env.OPENAI_VISION_MODEL||'gpt-4.1-mini'):(process.env.OPENAI_THEME_EDITOR_MODEL||'gpt-4.1');
 const started=Date.now(),body={model,messages:[{role:'system',content:prompt},{role:'user',content:JSON.stringify(input)}],response_format:{type:'json_schema',json_schema:schema}};
 if(/^(gpt-5|o\d)/i.test(model)){body.max_completion_tokens=phase==='analysis'?6500:4000;body.reasoning_effort='low'}else{body.max_tokens=phase==='analysis'?5000:3200;body.temperature=phase==='analysis'?.1:.25}
 // Exactly one transport attempt. Validation errors never trigger hidden AI repair/retry.
 const response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
 if(!response.ok)throw new Error('PREMIUM_'+phase.toUpperCase()+'_HTTP_'+response.status);
 const data=await response.json();if(data.choices?.[0]?.finish_reason!=='stop')throw new Error('PREMIUM_INCOMPLETE_'+phase.toUpperCase());
 return{value:JSON.parse(data.choices[0].message.content),metrics:{phase,model:data.model||model,durationMs:Date.now()-started,inputTokens:data.usage?.prompt_tokens||0,outputTokens:data.usage?.completion_tokens||0,usage:aiUsageProperties({data:{usage:data.usage}},data.model||model,'premium_unified_'+phase)}};
}
function analysisValid(r){try{if(r?.generation?.source!=='real-ai'||r.analysisSchemaVersion!==VERSIONS.analysisSchemaVersion||r.analysisPromptVersion!==VERSIONS.analysisPromptVersion)return false;validateAnalysis(r.unifiedAnalysis);return true}catch{return false}}
function reportValid(r){try{if(!analysisValid(r)||r.finalCopySchemaVersion!==VERSIONS.finalCopySchemaVersion||r.finalCopyPromptVersion!==VERSIONS.finalCopyPromptVersion)return false;validateFinalCopy(r.globalFinalCopy,r.unifiedAnalysis);return true}catch{return false}}
function createPremiumPipeline({store,callAI=modelCall,beforeGenerate=async()=>{},afterGenerate=async()=>{}}){
 const inFlight=new Map();
 async function run(scope,messages,people){const started=Date.now(),rows=await store.read(scope);const complete=rows.find(row=>reportValid(row.result));if(complete)return{...complete.result,generation:{...complete.result.generation,aiCalls:0,analysisCalls:0,finalCopyCalls:0,cached:true,requestDurationMs:Date.now()-started}};
 if(!messages.length)throw new Error('CONVERSATION_REQUIRED');const permit=await beforeGenerate(scope);const context=selectedContext(messages);let unifiedAnalysis=rows.find(row=>analysisValid(row.result))?.result.unifiedAnalysis;const analysisReused=Boolean(unifiedAnalysis),calls=[];
 if(!unifiedAnalysis){const analysis=await callAI({phase:'analysis',prompt:analysisPrompt,input:{locale:scope.locale,people,selectedContext:context},schema:analysisSchema});calls.push(analysis.metrics);unifiedAnalysis=validateAnalysis(analysis.value,context)}
 const report={relationshipId:scope.relationshipId,sourceSnapshotId:scope.sourceSnapshotId,sourceVersion:scope.sourceVersion,locale:scope.locale,...VERSIONS,generatedAt:new Date().toISOString(),unifiedAnalysis,globalFinalCopy:null,generation:{source:'real-ai',cached:false,analysisReused,analysisCalls:analysisReused?0:1,finalCopyCalls:0,aiCalls:analysisReused?0:1}};
 // One row owns one unified analysis and one global final copy. Incomplete rows cannot render.
 const id=await store.begin(scope,report,messages.length);
 try{const final=await callAI({phase:'finalCopy',prompt:finalPrompt,input:{locale:scope.locale,people,selectedContext:context,unifiedAnalysis,sharedFactPool:unifiedAnalysis.facts},schema:finalCopySchema});calls.push(final.metrics);report.globalFinalCopy=validateFinalCopy(final.value,unifiedAnalysis);assertLocale(Object.values(report.globalFinalCopy).flatMap(t=>[t.headline,t.narrative,...t.insights.flatMap(i=>[i.title,i.body])]),scope.locale);report.validation=overlapChecks(report.globalFinalCopy);report.generation={...report.generation,finalCopyCalls:1,aiCalls:analysisReused?1:2,requestDurationMs:Date.now()-started,calls};await store.complete(id,report);await afterGenerate(scope,permit,report).catch(()=>undefined);return report}catch(error){await store.failed(id).catch(()=>undefined);throw error}
 }
 return{generate(scope,messages,people){const key=JSON.stringify([scope.userId,scope.relationshipId,scope.sourceSnapshotId,scope.sourceVersion,scope.locale,VERSIONS]);if(inFlight.has(key))return inFlight.get(key);const pending=run(scope,messages,people);inFlight.set(key,pending);void pending.finally(()=>{if(inFlight.get(key)===pending)inFlight.delete(key)}).catch(()=>undefined);return pending},inFlight};
}
module.exports={createPremiumPipeline,selectedContext,modelCall,analysisValid,reportValid};
