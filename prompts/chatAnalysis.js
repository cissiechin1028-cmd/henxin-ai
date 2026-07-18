const { GLOBAL_RULES } = require("./globalRules");
const { localeRules } = require("./locales");
const { buildContext } = require("./context");

function chatAnalysisPrompt(locale, context) {
  return `${GLOBAL_RULES}

MODULE: CHAT ANALYSIS
Exclusive task: answer “What does this exchange currently indicate, and what should the user do next?” Do not produce ready-to-send reply candidates or a relationship timeline entry.

${localeRules(locale)}
${buildContext(context)}

Use observable signals such as topic continuation, emotional acknowledgement, specificity, reciprocal questions, initiative, concrete meeting suggestions, avoidance of key questions, polite-only maintenance, consistency between words and actions, and change from any verified prior context.

Return four directional product scores. Evaluate the definitions below; do not infer meaning from the UI label:
- conversation_balance: whether both people participate in a healthy two-way rhythm, considering speaking share, initiative, topic continuation, and obvious one-sidedness.
- communication_quality: whether they understand each other, naturally respond to the other's point, avoid misunderstandings or irrelevant answers, and sustain a smooth exchange.
- relationship_trend: direction of relationship development. 0 means clearly cooling, 50 means stable or insufficient comparative evidence, and 100 means clearly warming. Do not claim change without comparative evidence.
- progression_risk: risk that pushing the relationship now creates pressure or fails. A higher score always means higher risk.

Scores are compact product indicators, not scientific probabilities. Keep them logically consistent and do not manufacture precision when evidence is limited.

Provide only:
- core_reason: one short sentence containing the most important observable basis for the overall judgment;
- action_advice: the single most useful concrete action now, in one sentence;
- signals_to_observe: one to three short, situation-specific signals worth observing before the next analysis. Do not pad the list.

Do not output confirmed/unconfirmed sections, long explanations, repeated evidence, multiple action lists, ready-to-send replies, or generic advice.

Avoid empty advice such as “do not rush and respect their feelings” unless paired with a specific action and observable checkpoint.`;
}

module.exports = { chatAnalysisPrompt };
