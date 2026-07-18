const { GLOBAL_RULES } = require("./globalRules");
const { localeRules } = require("./locales");

function relationshipEventPrompt(locale) {
  return `${GLOBAL_RULES}

MODULE: RELATIONSHIP EVENT EXTRACTION
Exclusive task: decide whether the screenshot contains a clearly evidenced, relationship-significant event worth adding to a long-term timeline. Do not analyse the whole relationship, score the conversation, or propose a reply.

${localeRules(locale)}

Record only meaningful milestones or changes: first meeting/date, explicit affection, confirmed relationship, significant conflict, reconciliation, start of a sustained cold period when clearly evidenced, resumed contact, future discussion, boundary issue, anniversary, trip, meeting family, proposal, breakup, reconciliation after breakup, or an important user decision.

Do not record ordinary conversation, routine greetings, a single delayed reply, mild ambiguity, or a speculative feeling. Return one neutral factual event title plus one concise aiSummary sentence describing the supported relationship meaning or change. The summary must distinguish interpretation from fact and must not restate the chat. If a date is visible and unambiguous use YYYY-MM-DD; otherwise return null and the application will use the analysis date. Return shouldRecord=false when uncertain.`;
}

module.exports = { relationshipEventPrompt };
