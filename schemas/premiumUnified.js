const VERSIONS=Object.freeze({analysisSchemaVersion:'premium-unified-analysis-v3',analysisPromptVersion:'premium-unified-analysis-prompt-v3',finalCopySchemaVersion:'premium-global-final-copy-v2',finalCopyPromptVersion:'premium-global-final-copy-prompt-v3'});
const string={type:'string',minLength:1},list=(items,min=1,max=20)=>({type:'array',items,minItems:min,maxItems:max}),object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties}),choice=values=>({type:'string',enum:values});
const themes=['type','feelings','future'];
const refs=list(string,1,4),short=max=>({type:'string',minLength:1,maxLength:max});
const analysisBody=object({relationshipState:choice(['new','ambiguous','dating','stable_couple','long_distance','cooling','conflict','breakup_risk','reconnecting','reconciliation','one_sided','unknown']),trajectory:choice(['warming','stable','cooling','reconnecting','repairing','deteriorating','mixed','unknown']),confidence:choice(['low','medium','high']),evidenceGaps:list(short(45),0,2),facts:list(object({id:{type:'string',pattern:'^F[0-9]{2,3}$'},category:choice(['rhythm','roles','initiative','investment','affection','cooling','planning','conflict','repair','consistency','relationship_definition','trajectory','next_development','branch_point','confirming_signal','stagnation_signal']),statement:short(65),subject:choice(['self','partner','pair']),primaryTheme:choice(themes),secondaryThemes:list(choice(themes),0,2),strength:choice(['low','medium','high']),basis:choice(['behavior','direct_emotion','longitudinal_change','uncertain']),recency:choice(['baseline','recent','change_over_time']),sourceMessageIds:list(string,1,3)}),6,10),typeAnalysis:object({coreFactIds:refs}),feelingsAnalysis:object({focalPersonId:string,coreFactIds:refs}),futureAnalysis:object({coreFactIds:refs,nextStep:short(45),nextStepFactIds:refs,branch:short(55),branchFactIds:refs})});
const theme=object({headline:{type:'string',minLength:8,maxLength:80},narrative:{type:'string',minLength:60,maxLength:240},supportFactIds:refs,insights:list(object({title:{type:'string',minLength:6,maxLength:60},body:{type:'string',minLength:35,maxLength:180},supportFactIds:refs}),2,2)});
const finalBody=object({type:theme,feelings:theme,future:theme});
const analysisSchema={name:'renai_premium_unified_analysis_v3',strict:true,schema:analysisBody},finalCopySchema={name:'renai_premium_global_final_copy_v2',strict:true,schema:finalBody};
function analysisSchemaFor(focalId){const schema=structuredClone(analysisSchema);schema.schema.properties.feelingsAnalysis.properties.focalPersonId={type:'string',enum:[focalId]};return schema}
function validateShape(value,schema,path='root'){
 const fail=()=>{throw new Error('PREMIUM_SCHEMA_INVALID:'+path)};
 if(schema.type==='object'){if(!value||typeof value!=='object'||Array.isArray(value))fail();if(Object.keys(value).some(k=>!Object.hasOwn(schema.properties,k)))fail();for(const k of schema.required)validateShape(value[k],schema.properties[k],path+'.'+k)}
 else if(schema.type==='array'){if(!Array.isArray(value)||value.length<schema.minItems||value.length>schema.maxItems)fail();value.forEach((v,i)=>validateShape(v,schema.items,path+'.'+i))}
 else if(schema.type==='string'){if(typeof value!=='string'||!value.trim()||value.length<(schema.minLength||1)||value.length>(schema.maxLength||Infinity)||schema.enum&&!schema.enum.includes(value)||schema.pattern&&!new RegExp(schema.pattern).test(value))fail()}
}
function validateReferences(value,ids){if(Array.isArray(value))value.forEach(v=>validateReferences(v,ids));else if(value&&typeof value==='object'){for(const[k,v]of Object.entries(value)){if(k==='supportFactIds'||k==='coreFactIds'||k==='nextStepFactIds'||k==='branchFactIds'){if(new Set(v).size!==v.length||v.some(id=>!ids.has(id)))throw new Error('PREMIUM_UNKNOWN_OR_DUPLICATE_FACT_ID')}else validateReferences(v,ids)}}}
function validateAnalysis(value,context,expectedFocalPersonId){
 validateShape(value,analysisBody);
 if(expectedFocalPersonId&&value.feelingsAnalysis.focalPersonId!==expectedFocalPersonId)throw new Error('PREMIUM_FOCAL_PERSON_MISMATCH');
 const ids=new Set(value.facts.map(f=>f.id));if(ids.size!==value.facts.length)throw new Error('PREMIUM_DUPLICATE_FACT_ID');validateReferences(value,ids);
 const statements=value.facts.map(f=>normalize(f.statement));if(new Set(statements).size!==statements.length)throw new Error('PREMIUM_DUPLICATE_FACT_MATERIAL');
 for(const f of value.facts){if(f.secondaryThemes.includes(f.primaryTheme)||new Set(f.secondaryThemes).size!==f.secondaryThemes.length)throw new Error('PREMIUM_FACT_MULTIPLE_PRIMARY_OWNERS');if(f.primaryTheme==='feelings'&&f.subject!=='partner')throw new Error('PREMIUM_FEELINGS_FACT_WRONG_SUBJECT')}
 for(const t of themes){const owned=value.facts.filter(f=>f.primaryTheme===t);if(owned.length<2)throw new Error('PREMIUM_ANALYSIS_INSUFFICIENT_PRIMARY_FACTS:'+t);if(!validOwnedSupport(value[t+'Analysis'].coreFactIds,t,value.facts))throw ownershipError('PREMIUM_ANALYSIS_OWNERSHIP_FAIL:'+t,value[t+'Analysis'].coreFactIds,t,value.facts,t+'Analysis.coreFactIds')}
 const future=value.facts.filter(f=>f.primaryTheme==='future');if(future.some(f=>!['trajectory','planning','cooling','repair','next_development','branch_point','confirming_signal','stagnation_signal'].includes(f.category)))throw new Error('PREMIUM_FUTURE_NON_TEMPORAL_FACT');
 for(const field of ['nextStepFactIds','branchFactIds'])if(!validOwnedSupport(value.futureAnalysis[field],'future',value.facts))throw ownershipError('PREMIUM_FUTURE_UNSUPPORTED_CONCLUSION:'+field,value.futureAnalysis[field],'future',value.facts,'futureAnalysis.'+field);
 if(context){const messages=new Map([...context.baseline,...context.recent].map(m=>[m.id,m]));for(const f of value.facts){if(f.sourceMessageIds.some(id=>!messages.has(id)))throw new Error('PREMIUM_UNKNOWN_MESSAGE_ID');if(f.subject==='partner'&&!f.sourceMessageIds.some(id=>messages.get(id).sender==='partner'))throw new Error('PREMIUM_PARTNER_FACT_WITHOUT_PARTNER_EVIDENCE')}}
 return value;
}
// First reference is the conclusion's primary support. An explicitly licensed contextual
// reference may accompany it 1:1; counting a tie as foreign dominance rejected valid use.
function ownershipDetails(ids,theme,facts,path){
 const byId=new Map(facts.map(f=>[f.id,f]));
 const references=ids.map(id=>{const f=byId.get(id);return f?{id,primaryTheme:f.primaryTheme,secondaryThemes:f.secondaryThemes,category:f.category}:{id,missing:true}});
 const ownedReferenceIds=references.filter(f=>f.primaryTheme===theme).map(f=>f.id);
 const secondaryReferenceIds=references.filter(f=>!f.missing&&f.primaryTheme!==theme).map(f=>f.id);
 const missingFactIds=references.filter(f=>f.missing).map(f=>f.id);
 const unlicensedSecondaryFactIds=references.filter(f=>!f.missing&&f.primaryTheme!==theme&&!f.secondaryThemes.includes(theme)).map(f=>f.id);
 const failedRules=[];
 if(!ids.length)failedRules.push('EMPTY_SUPPORT');
 if(missingFactIds.length)failedRules.push('UNKNOWN_FACT_IDS');
 if(references[0]?.primaryTheme!==theme)failedRules.push('FIRST_REFERENCE_NOT_PRIMARY_OWNED');
 if(ownedReferenceIds.length<secondaryReferenceIds.length)failedRules.push('SECONDARY_SUPPORT_OUTNUMBERS_PRIMARY');
 if(unlicensedSecondaryFactIds.length)failedRules.push('SECONDARY_THEME_NOT_LICENSED');
 return {path,theme,referenceIds:ids,references,availablePrimaryFactIds:facts.filter(f=>f.primaryTheme===theme).map(f=>f.id),ownedReferenceIds,secondaryReferenceIds,missingFactIds,unlicensedSecondaryFactIds,failedRules};
}
function ownershipError(code,ids,theme,facts,path){const error=new Error(code);error.validationDetails=ownershipDetails(ids,theme,facts,path);return error}
function validOwnedSupport(ids,theme,facts){return ownershipDetails(ids,theme,facts).failedRules.length===0}
function ownershipChecks(copy,analysis){
 const byId=new Map(analysis.facts.map(f=>[f.id,f])),result={};
 for(const t of themes){const blocks=[copy[t],...copy[t].insights];const owned=new Set();for(const block of blocks){const facts=block.supportFactIds.map(id=>byId.get(id));if(facts.some(f=>!f))throw new Error('PREMIUM_UNKNOWN_OR_DUPLICATE_FACT_ID');const primary=facts.filter(f=>f.primaryTheme===t);if(!validOwnedSupport(block.supportFactIds,t,analysis.facts))throw ownershipError('PREMIUM_CONTENT_OWNERSHIP_FAIL:'+t,block.supportFactIds,t,analysis.facts,block===copy[t]?t+'.supportFactIds':t+'.insights['+copy[t].insights.indexOf(block)+'].supportFactIds');primary.forEach(f=>owned.add(f.id))}if(owned.size<2)throw new Error('PREMIUM_CONTENT_INSUFFICIENT_OWNED_FACTS:'+t);result[t]={ownedFactIds:[...owned],blocksValidated:3}}
 return result;
}
const sensitiveClaims=[
 {name:'comparative_safety',copy:/安心(?:感)?(?:が|のほうが|の方が)?(?:勝|上回|優勢)/u,evidence:/安心(?:感)?(?:が|のほうが|の方が)?(?:勝|上回|優勢)/u,basis:'direct_emotion'},
 {name:'increased_affection',copy:/(?:気持ち|好意|愛情|好きな思い)(?:が|は).{0,8}(?:強ま|増し|増え|深ま)/u,evidence:/(?:前より|以前より|ますます|もっと).{0,12}(?:好き|愛し|大切)|(?:気持ち|好意|愛情).{0,8}(?:強ま|増し|増え|深ま)/u,basis:'longitudinal_change'},
 {name:'preserve_relationship',copy:/(?:関係|仲).{0,6}(?:壊したくない|失いたくない)|失うの.{0,3}怖/u,evidence:/(?:関係|仲).{0,6}(?:壊したくない|失いたくない)|失うの.{0,3}怖/u,basis:'direct_emotion'},
 {name:'rejection_fear',copy:/(?:拒絶|拒否|断られ).{0,8}(?:恐|怖|不安)/u,evidence:/(?:拒絶|拒否|断られ).{0,8}(?:恐|怖|不安)/u,basis:'direct_emotion'}
];
function claimStrengthChecks(copy,analysis,context){const byId=new Map(analysis.facts.map(f=>[f.id,f])),messages=new Map(context?[...context.baseline,...context.recent].map(m=>[m.id,m]):[]);for(const t of themes){for(const block of [{text:copy[t].headline+'。'+copy[t].narrative,ids:copy[t].supportFactIds},...copy[t].insights.map(i=>({text:i.title+'。'+i.body,ids:i.supportFactIds}))]){const facts=block.ids.map(id=>byId.get(id));for(const rule of sensitiveClaims)if(rule.copy.test(block.text)&&!facts.some(f=>f.strength==='high'&&f.basis===rule.basis&&rule.evidence.test(f.statement)&&f.sourceMessageIds.some(id=>{const m=messages.get(id);return m&&m.sender===f.subject&&rule.evidence.test(m.text)})))throw new Error('PREMIUM_UNSUPPORTED_CLAIM:'+rule.name);if(facts.every(f=>f.strength==='low'||f.basis==='uncertain')&&/(?:好きです|愛しています|望んでいます|求めています|確実|必ず)/u.test(block.text))throw new Error('PREMIUM_CLAIM_EXCEEDS_STRENGTH')}}return{targetedClaimsChecked:true};}
const normalize=s=>s.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]/gu,'');
function overlapChecks(copy){const titles=themes.flatMap(t=>copy[t].insights.map(i=>normalize(i.title)));if(new Set(titles).size!==6)throw new Error('PREMIUM_DUPLICATE_INSIGHT_TITLE');const primary=themes.map(t=>copy[t].insights.map(i=>i.supportFactIds[0]));if(primary[0].some(id=>primary[1].includes(id)&&primary[2].includes(id)))throw new Error('PREMIUM_PRIMARY_FACT_DOMINATES_ALL_THEMES');const texts=themes.flatMap(t=>[copy[t].narrative,...copy[t].insights.map(i=>i.body)]).map(normalize);for(let i=0;i<texts.length;i++)for(let j=i+1;j<texts.length;j++){const a=texts[i],b=texts[j],grams=new Set(Array.from({length:Math.max(0,a.length-17)},(_,n)=>a.slice(n,n+18)));const hits=Array.from({length:Math.max(0,b.length-17)},(_,n)=>b.slice(n,n+18)).filter(g=>grams.has(g)).length;if(hits>12&&hits/Math.max(1,Math.min(a.length,b.length)-17)>.45)throw new Error('PREMIUM_EXCESSIVE_PHRASE_OVERLAP')}return{identicalTitles:false,excessiveRepeatedPhrases:false,samePrimaryFactAcrossAllThemes:false}}
function validateFinalCopy(value,analysis,context,expectedFocalPersonId){validateShape(value,finalBody);validateAnalysis(analysis,context,expectedFocalPersonId);validateReferences(value,new Set(analysis.facts.map(f=>f.id)));overlapChecks(value);ownershipChecks(value,analysis);claimStrengthChecks(value,analysis,context);for(const t of themes){if(value[t].insights.some(i=>/[?？]/u.test(i.title)))throw new Error('PREMIUM_QUESTION_TITLE');const prose=[value[t].headline,value[t].narrative,...value[t].insights.flatMap(i=>[i.title,i.body])].join('\n');if(/ユーザー|相手側|\b(?:user|other person|SELF|PARTNER)\b/iu.test(prose))throw new Error('PREMIUM_SYSTEM_ACTOR_LANGUAGE')}return value}
module.exports={VERSIONS,analysisSchema,analysisSchemaFor,finalCopySchema,validateAnalysis,validateFinalCopy,overlapChecks,ownershipChecks,claimStrengthChecks,validOwnedSupport,ownershipDetails,themes};
