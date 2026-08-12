const test = require("node:test");
const assert = require("node:assert/strict");
const { cleanStrategyInput, strategySchema } = require("../services/strategyGenerator");

test("strategy input compacts arrays and preserves verified places", () => {
  const cleaned = cleanStrategyInput({ topic: { id: "date-plan", title: "デートプラン" }, answers: { mood: ["静か", "自然"] }, places: [{ id: "p1", name: "Cafe", address: "Tokyo", mapsUrl: "https://maps.example/p1" }] });
  assert.equal(cleaned.value.topic.id, "date-plan");
  assert.deepEqual(cleaned.value.answers.mood, ["静か", "自然"]);
  assert.equal(cleaned.value.verifiedPlaces[0].name, "Cafe");
});

test("date plan rejects invented-place generation input", () => {
  assert.equal(cleanStrategyInput({ topic: { id: "date-plan", title: "デートプラン" } }).error, "VERIFIED_PLACES_REQUIRED");
});

test("strategy output schema requires every rendered section", () => {
  assert.deepEqual(strategySchema.schema.required, ["headline", "currentSituation", "steps", "avoid", "reactions", "checkpoints", "cautions", "backupPlan", "budgetNote"]);
});
