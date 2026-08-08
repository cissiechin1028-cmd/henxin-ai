const AI_USAGE_CONFIG = Object.freeze({
  featureUnits: Object.freeze({
    reply: Number(process.env.AI_USAGE_REPLY_UNITS || 30),
    analysis: Number(process.env.AI_USAGE_CHAT_UNITS || 100),
    relationshipLog: Number(process.env.AI_USAGE_RELATIONSHIP_LOG_UNITS || 5),
    consultation: Number(process.env.AI_USAGE_CONSULTATION_UNITS || 25),
  }),
  tierBudgetUnits: Object.freeze({
    lite: Number(process.env.LITE_FAIR_USE_BUDGET_UNITS || 3333),
    premium: Number(process.env.PREMIUM_FAIR_USE_BUDGET_UNITS || process.env.PRO_FAIR_USE_BUDGET_UNITS || 10000),
  }),
});

module.exports = { AI_USAGE_CONFIG };
