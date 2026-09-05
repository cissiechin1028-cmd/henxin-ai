const {premiumPeople}=require('./premiumIdentity');
const {VERSIONS}=require('../schemas/premiumUnified');
const {createPremiumPipeline}=require('./premiumDiagnosis');
function registerPremiumDiagnosisRoute(app,{express,supabase,resolveRelationship,usageService,tracking}){
 const metadata=scope=>({source:'premium_unified',source_snapshot_id:scope.sourceSnapshotId,source_version:scope.sourceVersion,locale:scope.locale,analysis_schema_version:VERSIONS.analysisSchemaVersion,analysis_prompt_version:VERSIONS.analysisPromptVersion});
 const store={
 async read(scope){const{data,error}=await supabase.from('analyses').select('id,result,status').eq('user_id',scope.userId).eq('relationship_id',scope.relationshipId).contains('input_metadata',metadata(scope)).order('created_at',{ascending:false}).limit(30);if(error)throw new Error('PREMIUM_CACHE_READ_FAILED');return data||[]},
 async begin(scope,report,count){const{data,error}=await supabase.from('analyses').insert({user_id:scope.userId,relationship_id:scope.relationshipId,mode:'analysis',status:'processing',title:'premium:unified',result:report,input_metadata:{...metadata(scope),final_copy_schema_version:VERSIONS.finalCopySchemaVersion,final_copy_prompt_version:VERSIONS.finalCopyPromptVersion,message_count:count}}).select('id').single();if(error)throw new Error('PREMIUM_ANALYSIS_SAVE_FAILED');return data.id},
 async complete(id,report){const{error}=await supabase.from('analyses').update({result:report,status:'completed',completed_at:new Date().toISOString()}).eq('id',id);if(error)throw new Error('PREMIUM_REPORT_SAVE_FAILED')},
 async failed(id,result,code){const{error}=await supabase.from('analyses').update({result,status:'failed',error_code:code.slice(0,120)}).eq('id',id);if(error)throw new Error('PREMIUM_FAILURE_SAVE_FAILED')}
 };
 const pipeline=createPremiumPipeline({store,beforeGenerate:async scope=>{const usage=await usageService.check(scope.userId,'analysis');if(!usage.allowed)throw new Error('FAIR_USE_LIMIT_REACHED');return usage},afterGenerate:async(scope,usage,report)=>{await usageService.recordSuccess(usage);for(const call of report.generation.calls)await tracking.record({name:'ai_usage_completed',businessKey:`premium_unified:${scope.userId}:${scope.relationshipId}:${scope.sourceSnapshotId}:${report.generatedAt}:${call.phase}`,userId:scope.userId,source:'ai',properties:{module:'analysis',mode:'premium_unified',...call.usage}}).catch(()=>undefined)}});
 app.post('/api/v1/anonymous/conversation-theme-reports',express.json({limit:'256kb'}),async(req,res)=>{
 try{const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,''),user=token?(await supabase.auth.getUser(token)).data?.user:null;if(!user)return res.status(401).json({error:'AUTH_REQUIRED'});
 const relationship=await resolveRelationship(user.id,String(req.body?.relationshipId||''));if(relationship.error||!relationship.data)return res.status(relationship.status||500).json({error:relationship.code||'RELATIONSHIP_READ_FAILED'});
 if(req.body?.themeId&&!['futarirashisa','type','feelings','future'].includes(req.body.themeId))return res.status(400).json({error:'INVALID_DIAGNOSIS_THEME'});
 const sourceSnapshotId=String(req.body?.sourceSnapshotId||'').slice(0,120),sourceVersion=String(req.body?.sourceVersion||'').slice(0,160);if(!sourceSnapshotId||!sourceVersion)return res.status(400).json({error:'PREMIUM_SOURCE_REQUIRED'});
 const requestedLocale=String(req.headers['x-locale']||'ja'),locale=['ja','zh-TW','en'].includes(requestedLocale)?requestedLocale:'ja';
 const messages=Array.isArray(req.body?.messages)?req.body.messages.filter(m=>['self','partner'].includes(m?.sender)&&String(m?.text||'').trim()&&(!m.dataType||m.dataType==='REAL')).slice(-500).map(m=>({sender:m.sender,text:String(m.text).trim().slice(0,1500),timestamp:m.timestamp==null?null:String(m.timestamp).slice(0,80)})):[];
 const {data:configured,error:identityError}=await supabase.from('reply_conversations').select('participant_identity,partner_name').eq('user_id',user.id).eq('relationship_id',relationship.data.id).is('deleted_at',null).order('updated_at',{ascending:false}).limit(1);
 if(identityError)throw new Error('PREMIUM_IDENTITY_READ_FAILED');
 const saved=configured?.[0],identity=saved?.participant_identity||{};
 const people=premiumPeople(relationship.data.id,{selfName:identity.selfName||req.body?.selfName,partnerName:identity.partnerName||saved?.partner_name||req.body?.partnerName});
 const report=await pipeline.generate({userId:user.id,relationshipId:relationship.data.id,sourceSnapshotId,sourceVersion,locale},messages,people);
 return res.status(report.generation.cached?200:201).json({premiumReport:report});
 }catch(error){const code=String(error.message||'PREMIUM_REPORT_FAILED');console.error('PREMIUM REPORT FAILED',code);if(error.validationDetails)console.error('PREMIUM VALIDATION DETAILS',JSON.stringify(error.validationDetails));return res.status(code==='FAIR_USE_LIMIT_REACHED'?429:code==='CONVERSATION_REQUIRED'?400:502).json({error:code,...(error.validationDetails?{validationDetails:error.validationDetails}:{})})}
 });return pipeline;
}
module.exports={registerPremiumDiagnosisRoute};
