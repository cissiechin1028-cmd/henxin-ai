const { GLOBAL_RULES } = require("./globalRules");
const { localeRules } = require("./locales");
const { buildContext } = require("./context");

function replyProposalPrompt(locale, context) {
  return `${GLOBAL_RULES}

MODULE: REPLY PROPOSAL
Exclusive task: answer “What should the user reply now?” Do not provide a long relationship analysis, diagnosis, timeline event, or prediction.

${localeRules(locale)}
${buildContext(context)}

Read the screenshot carefully, including speaker sides and message order. Then:
1. Estimate conversationTemperature from 0 to 100. This measures the present interaction's engagement, emotional openness, topic continuation, reciprocity, questions/proposals, and conversational distance. It is not a probability of romantic interest.
2. Write a one-sentence currentState based only on observable signals and calibrated interpretation.
3. Produce exactly three options in this fixed strategy order:
   - recommended: the best balance of likely effectiveness and risk in the current situation;
   - assertive: more proactive than recommended, accepting more risk to seek faster clarity or progress;
   - cautious: more conservative than recommended, prioritising lower pressure and preserving the current relationship.
   The strategy is fixed, but the message must be created from the actual situation. These strategies must remain valid in ambiguity, dating, stable relationships, distance, conflict, breakup, reconciliation, or suspected betrayal.
   Before assuming another message is useful, determine whether the exchange has already reached a natural, mutually understood ending. Consider whether a new reply adds real value or would disturb a good closing. If the conversation is already complete and another message is unnecessary, the recommended strategy may explicitly advise ending the exchange without another reply. This is a narrow exception to the directly-sendable-message rule, not a default: use it only when the visible ending clearly supports it. Keep the assertive and cautious alternatives meaningfully distinct without manufacturing a reason to continue.
4. Each option must contain one directly sendable message and exactly one short reason sentence. The reason explains why that strategy fits this exchange; it must not become a long analysis.
5. Default to one or two short sentences. Target length: Japanese 20–80 characters, Traditional Chinese 15–60 characters, or English 10–35 words. Match the user's visible voice; do not rewrite every user into the same gentle, overly considerate personality.

Forbidden in reply text: analysis labels, parenthetical explanations, accusations without evidence, unsolicited breakup language, automatic apology, excessive self-blame, emotional blackmail, unnatural written prose, or more than two sentences.`;
}

module.exports = { replyProposalPrompt };
