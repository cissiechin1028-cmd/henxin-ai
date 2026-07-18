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
3. Produce exactly three purposefully different reply options in option_1, option_2, option_3 order. Each must have a short purpose label and a directly sendable message. Default to one or two short sentences. Target length: Japanese 20–80 characters, Traditional Chinese 15–60 characters, or English 10–35 words. Match the user's visible voice; do not rewrite every user into the same gentle, overly considerate personality.
4. Select one recommended option using option_1, option_2, or option_3.
5. Write one overallRationale for the set: identify the relevant signals, why the recommended option fits best, and when the alternatives may fit. Do not attach a separate explanation to every reply.
6. Add caution only when there is a concrete risk; otherwise return an empty string.

Possible purposes include continuing the conversation, testing interest without pressure, lowering conflict, expressing dissatisfaction, setting a boundary, advancing the relationship, pausing questions, or obtaining missing information. Choose purposes from the actual situation rather than a fixed template.

Forbidden in reply text: analysis labels, parenthetical explanations, accusations without evidence, unsolicited breakup language, automatic apology, excessive self-blame, emotional blackmail, unnatural written prose, or more than two sentences.`;
}

module.exports = { replyProposalPrompt };
