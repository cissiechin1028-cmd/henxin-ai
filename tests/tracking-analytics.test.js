const test = require("node:test");
const assert = require("node:assert/strict");
const { eventModule, moduleOverview, moduleFunnel, moduleCosts } = require("../tracking/analytics");

const events = [
  { event_name: "reply_generation_started", anonymous_id: "a", properties: { module: "reply" } },
  { event_name: "ai_usage_completed", anonymous_id: "a", properties: { mode: "reply", total_tokens: 100, cost_micros: 25 } },
  { event_name: "reply_paywall_triggered", anonymous_id: "b", properties: { module: "reply" } },
  { event_name: "ai_usage_failed", user_id: "u", properties: { module: "analysis" } },
  { event_name: "strategy_generation_succeeded", user_id: "s", properties: { topic_id: "date-plan" } },
  { event_name: "module_home_viewed", anonymous_id: "a", properties: { module: "reply" } },
];

test("module is read from the unified module field with legacy mode and event-name fallbacks", () => {
  assert.equal(eventModule(events[0]), "reply");
  assert.equal(eventModule(events[1]), "reply");
  assert.equal(eventModule(events[4]), "strategy");
});

test("module overview, funnel and costs stay isolated", () => {
  assert.deepEqual(moduleOverview(events, "reply"), {
    module: "reply", events: 4, actors: 2, attempts: 1, successes: 1, failures: 0, successRate: 100, paywallTriggers: 1,
  });
  assert.equal(moduleFunnel(events, "reply").viewed.events, 1);
  assert.equal(moduleFunnel(events, "reply").started.events, 1);
  assert.equal(moduleFunnel(events, "reply").completed.events, 1);
  assert.equal(moduleCosts(events, "reply").costMicros, 25);
  assert.equal(moduleCosts(events, "analysis").calls, 0);
});
