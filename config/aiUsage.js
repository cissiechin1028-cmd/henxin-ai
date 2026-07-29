const AI_USAGE_CONFIG = Object.freeze({
  featureUnits: Object.freeze({
    reply: Number(process.env.AI_USAGE_REPLY_UNITS || 30),
    analysis: Number(process.env.AI_USAGE_CHAT_UNITS || 100),
    relationshipLog: Number(process.env.AI_USAGE_RELATIONSHIP_LOG_UNITS || 5),
  }),
  proBudgetUnits: Number(process.env.PRO_FAIR_USE_BUDGET_UNITS || 10000),
});

module.exports = { AI_USAGE_CONFIG };
