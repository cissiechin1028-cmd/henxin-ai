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

Scores are directional product indicators, not scientific probabilities:
- affection: visible interest and willingness to remain engaged.
- intentConsistency: consistency among wording, response behavior, and stated actions.
- relationshipTrend: rising, stable, falling, or unclear. Use unclear when evidence or comparison is insufficient.
- progressRisk: likely burden or counterproductive effect if the user pushes the relationship forward now.
- confidence: low, medium, or high, based on evidence quality and amount.

Each score reason must cite a distinct observable signal. Scores, reasons, conclusion, and next action must be logically consistent. A high affection score cannot rely only on politeness; a falling trend requires comparative evidence; insufficient information should produce moderate scores, unclear trend, and low confidence rather than invented precision.

Provide:
- a concise headline;
- whatCanBeConfirmed and whatCannotBeConfirmed;
- up to four short evidence observations;
- an integrated conclusion that does not repeat all score reasons;
- exactly three different, concrete actions in priority order;
- one nextBestMove;
- one signalToObserve next.

Avoid empty advice such as “do not rush and respect their feelings” unless paired with a specific action and observable checkpoint.`;
}

module.exports = { chatAnalysisPrompt };
