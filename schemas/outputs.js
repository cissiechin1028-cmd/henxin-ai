const replyProposalSchema = {
  name: "reply_proposal",
  strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["conversationTemperature", "currentState", "options"],
    properties: {
      conversationTemperature: { type: "integer", minimum: 0, maximum: 100 },
      currentState: { type: "string" },
      options: { type: "array", minItems: 3, maxItems: 3, items: { type: "object", additionalProperties: false, required: ["strategy", "text", "reason"], properties: { strategy: { type: "string", enum: ["option_1", "option_2", "option_3"] }, text: { type: "string" }, reason: { type: "string" } } } }
    }
  }
};

const chatAnalysisSchema = {
  name: "chat_analysis",
  strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["conversation_balance", "communication_quality", "relationship_trend", "progression_risk", "core_reason", "action_advice", "signals_to_observe"],
    properties: {
      conversation_balance: { type: "integer", minimum: 0, maximum: 100 },
      communication_quality: { type: "integer", minimum: 0, maximum: 100 },
      relationship_trend: { type: "integer", minimum: 0, maximum: 100 },
      progression_risk: { type: "integer", minimum: 0, maximum: 100 },
      core_reason: { type: "string" },
      action_advice: { type: "string" },
      signals_to_observe: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } }
    }
  }
};

const relationshipEventSchema = {
  name: "relationship_event",
  strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["shouldRecord", "eventType", "title", "aiSummary", "eventDate", "evidenceStrength"],
    properties: {
      shouldRecord: { type: "boolean" },
      eventType: { type: "string", enum: ["first_date", "birthday", "trip", "first_touch", "conflict", "reconciliation", "relationship_confirmed", "met_family", "proposal", "breakup", "reunion", "future_discussion", "boundary", "contact_resumed", "cold_period", "important_decision", "custom"] },
      title: { type: "string" },
      aiSummary: { type: "string" },
      eventDate: { type: ["string", "null"] },
      evidenceStrength: { type: "string", enum: ["insufficient", "clear"] }
    }
  }
};

const relationshipReportSchema = {
  name: "relationship_report",
  strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["relationshipChange", "importantEvents", "positiveSignals", "recurringPatterns", "principalRisks", "relationshipStage", "growth", "aiSummary", "nextSuggestion", "signalToObserve", "trend"],
    properties: {
      relationshipChange: { type: "string" },
      importantEvents: { type: "array", maxItems: 6, items: { type: "string" } },
      positiveSignals: { type: "array", maxItems: 3, items: { type: "string" } },
      recurringPatterns: { type: "array", maxItems: 3, items: { type: "string" } },
      principalRisks: { type: "array", maxItems: 3, items: { type: "string" } },
      relationshipStage: { type: "string" },
      growth: { type: "string" },
      aiSummary: { type: "string" },
      nextSuggestion: { type: ["string", "null"] },
      signalToObserve: { type: "string" },
      trend: { type: "string", enum: ["rising", "stable", "falling", "unclear"] }
    }
  }
};

module.exports = { replyProposalSchema, chatAnalysisSchema, relationshipEventSchema, relationshipReportSchema };
