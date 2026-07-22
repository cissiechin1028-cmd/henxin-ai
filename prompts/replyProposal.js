const { GLOBAL_RULES } = require("./globalRules");
const { localeRules } = require("./locales");
const { buildContext } = require("./context");

function replyProposalPrompt(locale, context) {
  const settings = normalizeReplySettings(context);
  return `${GLOBAL_RULES}

MODULE: REPLY PROPOSAL
Exclusive task: answer “What should the user reply now?” Do not provide a long relationship analysis, diagnosis, timeline event, or prediction.

${localeRules(locale)}
${buildContext(context)}

USER REPLY SETTINGS
- relationship_status: ${settings.relationshipStatus}
- reply_goal: ${settings.replyGoal || "not provided; infer a suitable communication objective silently from evidence"}
- reply_style: ${settings.replyStyle}

STYLE DEFINITIONS
- natural: realistic everyday conversation. Do not intentionally increase or decrease intimacy.
- get_closer: slightly warmer and more engaged, but never beyond the supported relationship stage.
- reassure: reduce anxiety and provide emotional steadiness before asking for information.
- humor: create a relaxed atmosphere only when the exchange is light enough. If the screenshot involves breakup, cheating, apology, grief, serious conflict, emotional collapse, or strong negative emotion, silently use natural instead.
- honest: clear and respectful. Reduce ambiguity without becoming harsh or manipulative.
- distance: lower emotional investment and preserve boundaries without sounding rude.

Read the screenshot carefully, including speaker sides and message order. Then:
1. Estimate conversationTemperature from 0 to 100. This measures only the present exchange's engagement, emotional openness, topic continuation, reciprocity, questions/proposals, and conversational distance. It is not a probability of romantic interest and must not be described as scientific certainty.
2. Write a one-sentence currentState based only on observable signals and calibrated interpretation.
3. Produce exactly three different reply candidates that all follow the selected reply_goal and reply_style:
   - option_1: the most balanced and natural candidate;
   - option_2: a meaningfully different wording with the same goal/style;
   - option_3: another meaningfully different wording with the same goal/style.
   Do not use recommended/assertive/cautious internally. Those old strategy modes are obsolete.
   Before assuming another message is useful, determine whether the exchange has already reached a natural, mutually understood ending. Consider whether a new reply adds real value or would disturb a good closing. If the conversation is already complete and another message is unnecessary, the recommended strategy may explicitly advise ending the exchange without another reply. This is a narrow exception to the directly-sendable-message rule, not a default: use it only when the visible ending clearly supports it. Keep the assertive and cautious alternatives meaningfully distinct without manufacturing a reason to continue.
4. Each option must contain one directly sendable message and exactly one short reason sentence. The reason explains why that strategy fits this exchange; it must not become a long analysis.
5. Default to one or two short sentences. Target length: Japanese 20–80 characters, Traditional Chinese 15–60 characters, or English 10–35 words. Match the user's visible voice; do not rewrite every user into the same gentle, overly considerate personality.

Platform rule: treat screenshots as generic chat-app screenshots. Never assume or mention any specific chat platform unless the screenshot itself clearly shows it and the platform name is necessary to understand the visible evidence.

Forbidden in reply text: analysis labels, parenthetical explanations, accusations without evidence, unsolicited breakup language, automatic apology, excessive self-blame, emotional blackmail, unnatural written prose, or more than two sentences.`;
}

function normalizeReplySettings(context = {}) {
  const allowedStyles = new Set(["natural", "get_closer", "reassure", "humor", "honest", "distance"]);
  const allowedStatuses = new Set(["unknown", "crush", "talking", "dating", "long_term", "cold", "conflict", "breakup", "reconciliation"]);
  return {
    replyGoal: String(context.replyGoal || "").trim().slice(0, 150),
    replyStyle: allowedStyles.has(context.replyStyle) ? context.replyStyle : "natural",
    relationshipStatus: allowedStatuses.has(context.relationshipStatus) ? context.relationshipStatus : "unknown",
  };
}

module.exports = { replyProposalPrompt };
