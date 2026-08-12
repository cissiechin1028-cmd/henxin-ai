const MODULES = new Set(["reply", "analysis", "strategy"]);

function normalizeModule(value) {
  const module = String(value || "").trim().toLowerCase();
  return MODULES.has(module) ? module : null;
}

function eventModule(event = {}) {
  const explicit = normalizeModule(event.properties?.module || event.properties?.mode || event.properties?.feature);
  if (explicit) return explicit;
  const name = String(event.event_name || "");
  if (name.startsWith("reply_")) return "reply";
  if (name.startsWith("analysis_") || name.startsWith("chat_analysis_")) return "analysis";
  if (name.startsWith("strategy_")) return "strategy";
  return null;
}

function actorId(event = {}) {
  return event.user_id || event.anonymous_id || null;
}

function eventsForModule(events, module) {
  return events.filter((event) => eventModule(event) === module);
}

function successful(event) {
  return event.event_name === "ai_usage_completed";
}

function failed(event) {
  return event.event_name === "ai_usage_failed";
}

function moduleOverview(events, module) {
  const scoped = eventsForModule(events, module);
  const successes = scoped.filter(successful);
  const failures = scoped.filter(failed);
  const attempts = successes.length + failures.length;
  const actors = new Set(scoped.map(actorId).filter(Boolean));
  return {
    module,
    events: scoped.length,
    actors: actors.size,
    attempts,
    successes: successes.length,
    failures: failures.length,
    successRate: attempts ? Number((successes.length / attempts * 100).toFixed(1)) : null,
    paywallTriggers: scoped.filter((event) => ["module_paywall_triggered", `${module}_paywall_triggered`].includes(event.event_name)).length,
  };
}

function moduleFunnel(events, module) {
  const scoped = eventsForModule(events, module);
  const stageNames = {
    viewed: new Set(["module_home_viewed", `${module}_home_viewed`, `${module}_viewed`]),
    selected: new Set(["module_item_selected", `${module}_selected`, `${module}_topic_selected`]),
    started: new Set(["module_generation_started", `${module}_generation_started`]),
    completed: new Set(["ai_usage_completed"]),
    paywall: new Set(["module_paywall_triggered", `${module}_paywall_triggered`]),
  };
  return Object.fromEntries(Object.entries(stageNames).map(([stage, names]) => {
    const matching = scoped.filter((event) => names.has(event.event_name));
    return [stage, {
      events: matching.length,
      actors: new Set(matching.map(actorId).filter(Boolean)).size,
    }];
  }));
}

function moduleCosts(events, module) {
  const aiEvents = eventsForModule(events, module).filter((event) => event.event_name === "ai_usage_completed");
  const calls = aiEvents.length;
  const promptTokens = aiEvents.reduce((sum, event) => sum + Number(event.properties?.prompt_tokens || 0), 0);
  const completionTokens = aiEvents.reduce((sum, event) => sum + Number(event.properties?.completion_tokens || 0), 0);
  const totalTokens = aiEvents.reduce((sum, event) => sum + Number(event.properties?.total_tokens || 0), 0);
  const costMicros = aiEvents.reduce((sum, event) => sum + Number(event.properties?.cost_micros || 0), 0);
  return { module, calls, promptTokens, completionTokens, totalTokens, costMicros,
    averageCostMicros: calls ? Math.round(costMicros / calls) : 0 };
}

module.exports = { normalizeModule, eventModule, eventsForModule, moduleOverview, moduleFunnel, moduleCosts };
