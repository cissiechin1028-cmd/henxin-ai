const replyProposalSchema = {
  name: "reply_proposal",
  strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["conversationTemperature", "currentState", "options", "recommendedOption", "overallRationale", "caution"],
    properties: {
      conversationTemperature: { type: "integer", minimum: 0, maximum: 100 },
      currentState: { type: "string" },
      options: { type: "array", minItems: 3, maxItems: 3, items: { type: "object", additionalProperties: false, required: ["purpose", "text"], properties: { purpose: { type: "string" }, text: { type: "string" } } } },
      recommendedOption: { type: "string", enum: ["option_1", "option_2", "option_3"] },
      overallRationale: { type: "string" },
      caution: { type: "string" }
    }
  }
};

const chatAnalysisSchema = {
  name: "chat_analysis",
  strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["affection", "intentConsistency", "relationshipTrend", "progressRisk", "confidence", "scoreReasons", "headline", "whatCanBeConfirmed", "whatCannotBeConfirmed", "evidence", "conclusion", "actions", "nextBestMove", "signalToObserve"],
    properties: {
      affection: { type: "integer", minimum: 0, maximum: 100 },
      intentConsistency: { type: "integer", minimum: 0, maximum: 100 },
      relationshipTrend: { type: "string", enum: ["rising", "stable", "falling", "unclear"] },
      progressRisk: { type: "integer", minimum: 0, maximum: 100 },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
      scoreReasons: { type: "object", additionalProperties: false, required: ["affection", "intentConsistency", "relationshipTrend", "progressRisk"], properties: { affection: { type: "string" }, intentConsistency: { type: "string" }, relationshipTrend: { type: "string" }, progressRisk: { type: "string" } } },
      headline: { type: "string" },
      whatCanBeConfirmed: { type: "string" },
      whatCannotBeConfirmed: { type: "string" },
      evidence: { type: "array", maxItems: 4, items: { type: "string" } },
      conclusion: { type: "string" },
      actions: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } },
      nextBestMove: { type: "string" },
      signalToObserve: { type: "string" }
    }
  }
};

const relationshipEventSchema = {
  name: "relationship_event",
  strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["shouldRecord", "eventType", "title", "note", "eventDate", "evidenceStrength"],
    properties: {
      shouldRecord: { type: "boolean" },
      eventType: { type: "string", enum: ["first_date", "birthday", "trip", "first_touch", "conflict", "reconciliation", "relationship_confirmed", "met_family", "proposal", "breakup", "reunion", "future_discussion", "boundary", "contact_resumed", "cold_period", "important_decision", "custom"] },
      title: { type: "string" },
      note: { type: "string" },
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
