const { GLOBAL_RULES } = require("./globalRules");
const { localeRules } = require("./locales");
const { buildContext } = require("./context");
const { embeddedRelationshipEventInstructions } = require("./relationshipEvent");

function chatAnalysisPrompt(locale, context) {
  return `${GLOBAL_RULES}

MODULE: CHAT ANALYSIS
Exclusive task: answer “What does this exchange currently indicate, and what should the user do next?” Do not produce ready-to-send reply candidates or a relationship timeline entry.

${localeRules(locale)}
${buildContext(context)}

${embeddedRelationshipEventInstructions()}

USER INPUT DIMENSIONS
- Relationship stage: ${String(context.relationshipStatus || "not selected")}
- Analysis focus: ${String(context.analysisFocus || "full")}
- Optional user note: ${String(context.userNote || "not provided")}

Treat the optional note as user-provided context, not verified evidence. Use the selected focus to prioritize the analysis, but do not omit safety-critical or strongly contradictory visible evidence.

Use observable signals such as topic continuation, emotional acknowledgement, specificity, reciprocal questions, initiative, concrete meeting suggestions, avoidance of key questions, polite-only maintenance, consistency between words and actions, and change from any verified prior context.

CURRENT-STATE WINDOW
- RECENT_PRIMARY messages define “今のふたり” and carry 80% of the interpretation.
- LONG_TERM_BASELINE messages carry at most 20% and are context for normal patterns or meaningful change, never a simple all-history average.
- When the supplied window is marked degraded or timestamps are sparse, lower apparent precision and keep unsupported dimensions near neutral rather than inventing change.
- Window metadata: ${JSON.stringify(context.dataWindow || {})}

AUTHORITATIVE PRODUCT SCORES
- The product has already calculated the five scores deterministically from the normalized transcript: ${JSON.stringify(context.authoritativeScores || {})}
- Return those exact integer values in the five score fields. Do not revise, smooth, or reinterpret them.
- Your role is to explain the supplied scores using visible evidence. Generated wording must never change the quantitative result.

Return these five directional product scores. Evaluate only the visible conversation evidence; do not infer meaning from the UI label:
- topic_compatibility: how naturally both people pick up, continue, and expand each other's topics. Shared subject matter alone is not enough without reciprocal engagement.
- tempo_compatibility: how comfortably turn-taking, message length, response pacing, and conversational transitions fit each other. If timestamps are absent or incomplete, do not penalize response speed; use only visible turn rhythm.
- interaction_balance: whether participation, initiative, questions, self-disclosure, and topic work are reasonably reciprocal rather than carried by one person.
- intimacy: observable emotional proximity through warmth, specificity, acknowledgement, trust, and mutual self-disclosure. Do not treat relationship status or affectionate words alone as proof.
- excitement: the current conversational energy and mutual willingness to keep the exchange moving, based on responsiveness, emotional reaction, initiative, and concrete continuation. This is not an affection probability.

Scores are compact product indicators, not scientific probabilities. Use 50 as neutral when evidence for a dimension is genuinely insufficient. Keep scores logically consistent and do not manufacture precision. For each score provide one short evidence-based reason in dimension_reasons using the same five keys.

For each score also provide a user-facing dimension_summary using the same five keys. In Japanese, use two compact natural sentences, approximately 60–140 Japanese characters, rather than one short reason. In other locales, use two similarly compact natural sentences within the schema length. Explain what the current score indicates, the most visible interaction characteristic, and only when supported a mild shortfall or tendency. This is a current-state description only. Do not include evidence headings, lists, quoted chat text, reasoning labels, next steps, advice, strategy, instructions, or future predictions. Japanese summaries must not use future-facing endings such as 「今後」「これから」「期待できます」「可能性があります／高いです」. End with what is visible now. dimension_summary must be meaningfully fuller than dimension_reasons and must not repeat the same generic text across dimensions.

Provide only:
- core_reason: one short sentence containing the most important observable basis for the overall judgment;
- action_advice: the single most useful concrete action now, in one sentence;
- signals_to_observe: one to three short, situation-specific signals worth observing before the next analysis. Do not pad the list.

Do not output confirmed/unconfirmed sections, long explanations, repeated evidence, multiple action lists, ready-to-send replies, or generic advice.

Avoid empty advice such as “do not rush and respect their feelings” unless paired with a specific action and observable checkpoint.`;
}

module.exports = { chatAnalysisPrompt };
