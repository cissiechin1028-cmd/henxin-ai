const test = require("node:test");
const assert = require("node:assert/strict");
const { safeProperties, createTracking } = require("../tracking/service");
const { aiUsageProperties } = require("../tracking/cost");

test("tracking properties reject sensitive and unknown values", () => {
  assert.deepEqual(safeProperties({
    model: "gpt-test", total_tokens: 42, prompt: "secret", chat_text: "secret", email: "person@example.com"
  }), { model: "gpt-test", total_tokens: 42 });
});

test("AI usage records tokens and reports unconfigured pricing", () => {
  const original = { ...process.env };
  delete process.env.OPENAI_INPUT_USD_PER_1M_TOKENS;
  delete process.env.OPENAI_OUTPUT_USD_PER_1M_TOKENS;
  const value = aiUsageProperties({ data: { usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 } } }, "model", "analysis");
  assert.equal(value.total_tokens, 125);
  assert.equal(value.cost_micros, 0);
  assert.equal(value.cost_status, "unconfigured");
  process.env = original;
});

test("AI cost uses environment pricing", () => {
  process.env.OPENAI_INPUT_USD_PER_1M_TOKENS = "1";
  process.env.OPENAI_CACHED_INPUT_USD_PER_1M_TOKENS = "0.5";
  process.env.OPENAI_OUTPUT_USD_PER_1M_TOKENS = "2";
  const value = aiUsageProperties({ data: { usage: {
    prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500,
    prompt_tokens_details: { cached_tokens: 200 }
  } } }, "model", "analysis");
  assert.equal(value.cost_micros, 1900);
  assert.equal(value.cost_status, "calculated");
});

test("tracking storage failure never rejects the business flow", async () => {
  const supabase = { from() { return { upsert() { return { select() { return { maybeSingle: async () => { throw new Error("offline"); } }; } }; } }; } };
  const tracking = createTracking({ supabase });
  const result = await tracking.record({ name: "test", businessKey: "test:1", properties: { model: "x" } });
  assert.equal(result, null);
});
