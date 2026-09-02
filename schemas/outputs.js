const replyProposalSchema = {
  name: "reply_proposal",
  strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["conversationTemperature", "currentState", "options", "timelineEvent"],
    properties: {
      conversationTemperature: { type: "integer", minimum: 0, maximum: 100 },
      currentState: { type: "string" },
      options: { type: "array", minItems: 3, maxItems: 3, items: { type: "object", additionalProperties: false, required: ["strategy", "text", "reason"], properties: { strategy: { type: "string", enum: ["option_1", "option_2", "option_3"] }, text: { type: "string" }, reason: { type: "string" } } } },
      timelineEvent: { type: "object", additionalProperties: false, required: ["shouldRecord", "eventType", "title", "aiSummary", "eventDate", "evidenceStrength"], properties: { shouldRecord: { type: "boolean" }, eventType: { type: "string", enum: ["first_date", "birthday", "trip", "first_touch", "conflict", "reconciliation", "relationship_confirmed", "met_family", "proposal", "breakup", "reunion", "future_discussion", "boundary", "contact_resumed", "cold_period", "important_decision", "custom"] }, title: { type: "string" }, aiSummary: { type: "string" }, eventDate: { type: ["string", "null"] }, evidenceStrength: { type: "string", enum: ["insufficient", "clear"] } } }
    }
  }
};

const chatAnalysisSchema = {
  name: "chat_analysis",
  strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["topic_compatibility", "tempo_compatibility", "interaction_balance", "intimacy", "excitement", "dimension_reasons", "dimension_summary", "core_reason", "action_advice", "signals_to_observe", "timelineEvent"],
    properties: {
      topic_compatibility: { type: "integer", minimum: 0, maximum: 100 },
      tempo_compatibility: { type: "integer", minimum: 0, maximum: 100 },
      interaction_balance: { type: "integer", minimum: 0, maximum: 100 },
      intimacy: { type: "integer", minimum: 0, maximum: 100 },
      excitement: { type: "integer", minimum: 0, maximum: 100 },
      dimension_reasons: { type: "object", additionalProperties: false, required: ["topic_compatibility", "tempo_compatibility", "interaction_balance", "intimacy", "excitement"], properties: { topic_compatibility: { type: "string" }, tempo_compatibility: { type: "string" }, interaction_balance: { type: "string" }, intimacy: { type: "string" }, excitement: { type: "string" } } },
      dimension_summary: { type: "object", additionalProperties: false, required: ["topic_compatibility", "tempo_compatibility", "interaction_balance", "intimacy", "excitement"], properties: { topic_compatibility: { type: "string", minLength: 80, maxLength: 180 }, tempo_compatibility: { type: "string", minLength: 80, maxLength: 180 }, interaction_balance: { type: "string", minLength: 80, maxLength: 180 }, intimacy: { type: "string", minLength: 80, maxLength: 180 }, excitement: { type: "string", minLength: 80, maxLength: 180 } } },
      core_reason: { type: "string" },
      action_advice: { type: "string" },
      signals_to_observe: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
      timelineEvent: { type: "object", additionalProperties: false, required: ["shouldRecord", "eventType", "title", "aiSummary", "eventDate", "evidenceStrength"], properties: { shouldRecord: { type: "boolean" }, eventType: { type: "string", enum: ["first_date", "birthday", "trip", "first_touch", "conflict", "reconciliation", "relationship_confirmed", "met_family", "proposal", "breakup", "reunion", "future_discussion", "boundary", "contact_resumed", "cold_period", "important_decision", "custom"] }, title: { type: "string" }, aiSummary: { type: "string" }, eventDate: { type: ["string", "null"] }, evidenceStrength: { type: "string", enum: ["insufficient", "clear"] } } }
    }
  }
};

const topicAnalysisSchema={name:"renai_topic_analysis",strict:true,schema:{type:"object",additionalProperties:false,required:["topic_id","readiness_status","verdict","summary","evidence","modules","missing_evidence","next_steps","follow_up_hint"],properties:{topic_id:{type:"string"},readiness_status:{type:"string",enum:["sufficient","partial"]},verdict:{type:"string"},summary:{type:"string"},evidence:{type:"array",maxItems:8,items:{type:"object",additionalProperties:false,required:["claim","excerpt","confidence"],properties:{claim:{type:"string"},excerpt:{type:"string"},confidence:{type:"string",enum:["high","medium","low"]}}}},modules:{type:"array",maxItems:10,items:{type:"object",additionalProperties:false,required:["type","title","items"],properties:{type:{type:"string"},title:{type:"string"},items:{type:"array",maxItems:6,items:{type:"string"}}}}},missing_evidence:{type:"array",maxItems:6,items:{type:"string"}},next_steps:{type:"array",minItems:1,maxItems:3,items:{type:"string"}},follow_up_hint:{type:"string",enum:["none","reply","strategy"]}}}};
const themeReportSchema={name:"renai_diagnosis_theme_report",strict:true,schema:{type:"object",additionalProperties:false,required:["chapters"],properties:{chapters:{type:"array",minItems:2,maxItems:4,items:topicAnalysisSchema.schema}}}};

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

module.exports = { replyProposalSchema, chatAnalysisSchema, topicAnalysisSchema, themeReportSchema, relationshipEventSchema, relationshipReportSchema };
