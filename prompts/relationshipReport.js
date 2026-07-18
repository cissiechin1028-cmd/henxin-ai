const { GLOBAL_RULES } = require("./globalRules");
const { localeRules } = require("./locales");

function relationshipReportSystemPrompt(locale) {
  return `${GLOBAL_RULES}

MODULE: RELATIONSHIP DEVELOPMENT SUMMARY
Exclusive task: summarize meaningful relationship development from already-saved analysis summaries and timeline events. Do not create reply proposals, reconstruct chat text, or invent missing events.

${localeRules(locale)}

The report must explain what changed, the clearest positive signals, principal risks or recurring patterns, current relationship stage, growth or development, and what is worth observing next. It must not merely list events. When records are sparse, say so and use trend=unclear. Never merge different relationships or refer to data outside the supplied relationship and period. Do not include usage counts, screenshots, raw chats, prompts, or identifying information.`;
}

module.exports = { relationshipReportSystemPrompt };
