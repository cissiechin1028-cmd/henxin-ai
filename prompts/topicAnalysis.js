const {GLOBAL_RULES}=require("./globalRules");
const {localeRules}=require("./locales");

function topicAnalysisPrompt(locale,{topicId,topicTitle,question,evidenceInstruction,requiredModules=[],optionalModules=[],readinessStatus="sufficient"}){
 const safetyRules=topicId==="dating-safety"?`\nSPECIAL SAFETY-CHECK CONTRACT:\nThis is a neutral evidence check, not a risk finder. False positives are the primary product harm. Never invent a concern because the user selected this feature. Judge only observable behavior in the transcript; the user's suspicion or trust is not evidence. Do not use nationality, gender, age, occupation, language, or dating platform as risk evidence. Ordinary slow, short, cold, irregular, awkward, cautious, or low-question replies; busy schedules; one declined video call; ordinary LINE exchange; or early affection alone are not safety signals.\nUse exactly one localized verdict equivalent to: no significant signal; insufficient material; mild signal; attention signal. Never say safe, dangerous, scammer, trustworthy, fraud probability, or a percentage. A no-significant-signal result must not add a however/but caveat. It may have zero risk evidence and zero concern modules; include only a compact checked-points module. A signal requires short quoted evidence. Raise concern only for sufficiently supported money/investment requests, credentials, verification codes or sensitive data, suspicious external links/actions, repeated major identity contradictions, coercion or boundary violations, persistent identity-confirmation avoidance, highly unnatural templated conversation, or a coherent combination such as rapid intimacy plus investment plus payment pressure. Do not recommend advancing the relationship. Do not open or investigate URLs.\nFor localized output use calm, concrete language. Relevant module types are checked_points, found_signals, signal_overlap, avoid_now, and verify_next; omit unsupported modules. follow_up_hint must be none.`:"";
 return `${GLOBAL_RULES}

MODULE: TOPIC-SPECIFIC CHAT ANALYSIS
${localeRules(locale)}

Selected diagnosis: ${topicTitle} (${topicId})
User question: ${question}
Readiness: ${readinessStatus}
Required report modules: ${requiredModules.join(", ")}
Optional modules (include only when supported): ${optionalModules.join(", ")}
Evidence boundary: ${evidenceInstruction}
${safetyRules}

Use only the supplied parsed conversation. A VISIBLE TIME label is evidence; TIME UNKNOWN forbids reply-speed, elapsed-time, or before/after timing claims. Separate observable facts from interpretations. Never state another person's private feeling as fact. Every material finding must cite a short representative message excerpt or explicitly say evidence is missing. If readiness is partial, narrow the conclusion and explain the limitation. Do not output the legacy four product metrics.

Return topic_id, readiness_status, verdict, summary, evidence, modules, missing_evidence, next_steps, and follow_up_hint. Evidence items require claim, excerpt, and confidence. Modules must use the configured module identifiers. next_steps must contain one to three light directional suggestions, never a ready-to-send message. follow_up_hint is none, reply, or strategy.`;
}
module.exports={topicAnalysisPrompt};
