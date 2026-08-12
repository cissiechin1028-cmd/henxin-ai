const test = require("node:test");
const assert = require("node:assert/strict");
const { cleanStrategyInput, strategySchema } = require("../services/strategyGenerator");

test("strategy input compacts arrays and preserves verified places", () => {
  const cleaned = cleanStrategyInput({ topic: { id: "date-plan", title: "デートプラン" }, answers: { mood: ["静か", "自然"] }, places: [{ id: "p1", name: "Cafe", address: "Tokyo", mapsUrl: "https://maps.example/p1" }] });
  assert.equal(cleaned.value.topic.id, "date-plan");
  assert.deepEqual(cleaned.value.answers.mood, ["静か", "自然"]);
  assert.equal(cleaned.value.verifiedPlaces[0].name, "Cafe");
});

test("real-world plans safely accept unavailable external data", () => {
  const cleaned = cleanStrategyInput({ topic: { id: "date-plan", title: "デートプラン" }, externalDataStatus: { places: "unavailable", weather: "unavailable" } });
  assert.equal(cleaned.error, undefined);
  assert.deepEqual(cleaned.value.verifiedPlaces, []);
  assert.equal(cleaned.value.externalDataStatus.places, "unavailable");
});

test("weather is compacted for one generation call", () => {
  const cleaned = cleanStrategyInput({ topic: { id: "travel-plan", title: "旅行プラン" }, weather: { area: "京都", days: [{ date: "2026-08-14", condition: "雨", temperatureMax: 29, temperatureMin: 24, precipitationProbability: 80, outdoorSuitability: "low" }] } });
  assert.equal(cleaned.value.weather.area, "京都");
  assert.equal(cleaned.value.weather.days[0].condition, "雨");
});

test("strategy output schema requires every rendered section", () => {
  assert.deepEqual(strategySchema.schema.required, ["headline", "currentSituation", "steps", "avoid", "reactions", "checkpoints", "cautions", "backupPlan", "budgetNote"]);
});
