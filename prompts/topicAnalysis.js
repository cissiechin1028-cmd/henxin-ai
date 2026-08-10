const {GLOBAL_RULES}=require("./globalRules");
const {localeRules}=require("./locales");

function topicAnalysisPrompt(locale,{topicId,topicTitle,question,evidenceInstruction,requiredModules=[],optionalModules=[],readinessStatus="sufficient"}){
 return `${GLOBAL_RULES}

MODULE: TOPIC-SPECIFIC CHAT ANALYSIS
${localeRules(locale)}

Selected diagnosis: ${topicTitle} (${topicId})
User question: ${question}
Readiness: ${readinessStatus}
Required report modules: ${requiredModules.join(", ")}
Optional modules (include only when supported): ${optionalModules.join(", ")}
Evidence boundary: ${evidenceInstruction}

Use only the supplied parsed conversation. A VISIBLE TIME label is evidence; TIME UNKNOWN forbids reply-speed, elapsed-time, or before/after timing claims. Separate observable facts from interpretations. Never state another person's private feeling as fact. Every material finding must cite a short representative message excerpt or explicitly say evidence is missing. If readiness is partial, narrow the conclusion and explain the limitation. Do not output the legacy four product metrics.

Return topic_id, readiness_status, verdict, summary, evidence, modules, missing_evidence, next_steps, and follow_up_hint. Evidence items require claim, excerpt, and confidence. Modules must use the configured module identifiers. next_steps must contain one to three light directional suggestions, never a ready-to-send message. follow_up_hint is none, reply, or strategy.`;
}
module.exports={topicAnalysisPrompt};
