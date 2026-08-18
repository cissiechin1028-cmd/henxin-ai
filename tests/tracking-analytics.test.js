const test = require("node:test");
const assert = require("node:assert/strict");
const { eventModule, moduleOverview, moduleFunnel, moduleCosts, aiUsageSummary, operationalEvents } = require("../tracking/analytics");
const { createTracking } = require("../tracking/service");

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

test("one anonymous user with three calls is one anonymous and one first AI user", () => {
  const anonymousEvents = [
    ...Array.from({ length: 3 }, () => ({ event_name: "ai_usage_completed", anonymous_id: "anon-1" })),
    { event_name: "first_ai_usage_completed", anonymous_id: "anon-1" },
  ];
  assert.deepEqual(aiUsageSummary(anonymousEvents), {
    calls: 3, users: 1, anonymousUsers: 1, firstAiUsers: 1, unattributedCalls: 0,
  });
});

test("one logged-in user with two calls is one user and one first AI user", () => {
  const userEvents = [
    { event_name: "ai_usage_completed", user_id: "user-1" },
    { event_name: "ai_usage_completed", user_id: "user-1" },
    { event_name: "first_ai_usage_completed", user_id: "user-1" },
  ];
  assert.deepEqual(aiUsageSummary(userEvents), {
    calls: 2, users: 1, anonymousUsers: 0, firstAiUsers: 1, unattributedCalls: 0,
  });
});

test("admin and test actors are excluded without removing normal anonymous users", () => {
  const tracked = [
    { event_name: "ai_usage_completed", user_id: "admin", anonymous_id: "admin-device" },
    { event_name: "ai_usage_completed", user_id: "test", anonymous_id: "test-device" },
    { event_name: "ai_usage_completed", anonymous_id: "normal-device" },
    { event_name: "first_ai_usage_completed", anonymous_id: "normal-device" },
  ];
  const filtered = operationalEvents(tracked, [
    { id: "admin", role: "admin", is_test_account: false },
    { id: "test", role: "user", is_test_account: true },
  ]);
  assert.deepEqual(aiUsageSummary(filtered), {
    calls: 1, users: 1, anonymousUsers: 1, firstAiUsers: 1, unattributedCalls: 0,
  });
});

test("unattributed AI calls remain visible instead of silently disappearing", () => {
  assert.equal(aiUsageSummary([{ event_name: "ai_usage_completed" }]).unattributedCalls, 1);
});

test("recording an attributed AI completion also writes its idempotent first-completion marker", async () => {
  const rows = [];
  const supabase = { from(table) {
    assert.equal(table, "tracking_events");
    return { upsert(payload) {
      rows.push(payload);
      return {
        select() { return { maybeSingle: async () => ({ data: payload, error: null }) }; },
        then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
      };
    } };
  } };
  await createTracking({ supabase }).record({
    name: "ai_usage_completed", businessKey: "call-1", anonymousId: "anon-1",
    properties: { module: "reply" },
  });
  assert.deepEqual(rows.map((row) => row.event_name), ["ai_usage_completed", "first_ai_usage_completed"]);
  assert.equal(rows[1].business_key, "first_ai_usage_completed:anonymous:anon-1");
});
