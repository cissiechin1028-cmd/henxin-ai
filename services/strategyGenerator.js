const { aiUsageProperties } = require("../tracking/cost");

const strategySchema = {
  name: "renai_strategy_plan",
  strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["headline", "currentSituation", "steps", "avoid", "reactions", "checkpoints", "cautions", "backupPlan", "budgetNote"],
    properties: {
      headline: { type: "string" }, currentSituation: { type: "string" },
      steps: { type: "array", minItems: 3, maxItems: 5, items: { type: "object", additionalProperties: false, required: ["title", "detail"], properties: { title: { type: "string" }, detail: { type: "string" } } } },
      avoid: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
      reactions: { type: "array", minItems: 3, maxItems: 3, items: { type: "object", additionalProperties: false, required: ["signal", "action"], properties: { signal: { type: "string" }, action: { type: "string" } } } },
      checkpoints: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
      cautions: { type: "array", maxItems: 4, items: { type: "string" } },
      backupPlan: { type: "string" }, budgetNote: { type: "string" },
    },
  },
};

const text = (value, max = 500) => typeof value === "string" ? value.trim().slice(0, max) : "";
const compactValue = (value) => Array.isArray(value) ? value.slice(0, 8).map((item) => text(item, 80)).filter(Boolean) : text(value, 240);
const compactRecord = (record, maxEntries) => Object.fromEntries(Object.entries(record && typeof record === "object" ? record : {}).slice(0, maxEntries).map(([key, value]) => [key, compactValue(value)]).filter(([, value]) => Array.isArray(value) ? value.length : Boolean(value)));

function cleanStrategyInput(body = {}) {
  const topicId = text(body.topic?.id, 60), topicTitle = text(body.topic?.title, 80);
  if (!topicId || !topicTitle) return { error: "TOPIC_REQUIRED" };
  const places = (Array.isArray(body.places) ? body.places : []).slice(0, 6).map((place) => ({
    id: text(place?.id, 200), name: text(place?.name, 120), address: text(place?.address, 220), mapsUrl: text(place?.mapsUrl, 500),
    rating: Number.isFinite(Number(place?.rating)) ? Number(place.rating) : undefined,
    priceLevel: text(place?.priceLevel, 40), weekdayDescriptions: Array.isArray(place?.weekdayDescriptions) ? place.weekdayDescriptions.slice(0, 7).map((item) => text(item, 160)) : [],
  })).filter((place) => place.id && place.name);
  if (topicId === "date-plan" && !places.length) return { error: "VERIFIED_PLACES_REQUIRED" };
  return { value: { topic: { id: topicId, title: topicTitle, summary: text(body.topic?.summary, 180) }, profile: compactRecord(body.profile, 20), answers: compactRecord(body.answers, 20), verifiedPlaces: places } };
}

async function generateStrategy(input) {
  const axios = require("axios");
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_NOT_CONFIGURED");
  const topicId = input.topic.id;
  const instructions = [
    "あなたは日本語の恋愛行動プラン作成者です。診断ではなく、実際に行動できる攻略を作ります。断定・操作・過度な期待を避け、相手の意思と安全を尊重してください。",
    "入力された関係段階、双方の傾向、今回の目的に合わせて内容を変えます。入力にない事実は作らないでください。",
    topicId === "date-plan" ? "デートプランでは verifiedPlaces にある実在地点だけを使ってください。営業時間、料金、移動時間、空席を推測しないでください。数時間から一日以内の流れにし、場所名を使う時は入力と完全一致させてください。" : "旅行・予約・実在店舗情報を勝手に追加しないでください。",
    "headline は今回の具体的な方針。steps は時間順の実行手順。avoid は今やらないこと。reactions は前向き・迷い・反応が薄い場合。checkpoints は次に観察する点。date-plan の場合 cautions、backupPlan、budgetNote も具体化し、それ以外は短くしてください。",
  ].join("\n");
  const model = process.env.OPENAI_STRATEGY_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";
  const response = await axios.post("https://api.openai.com/v1/chat/completions", {
    model, messages: [{ role: "system", content: instructions }, { role: "user", content: JSON.stringify(input) }], temperature: 0.2, max_tokens: 1800,
    response_format: { type: "json_schema", json_schema: strategySchema },
  }, { timeout: 60000, headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" } });
  const raw = String(response.data?.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
  if (!raw) throw new Error("AI_EMPTY_RESPONSE");
  return { result: JSON.parse(raw), model: response.data?.model || model, usage: aiUsageProperties(response, response.data?.model || model, "strategy") };
}

module.exports = { cleanStrategyInput, generateStrategy, strategySchema };
