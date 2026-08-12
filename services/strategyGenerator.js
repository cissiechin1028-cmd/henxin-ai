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
  const places = (Array.isArray(body.places) ? body.places : []).slice(0, 4).map((place) => ({
    id: text(place?.id, 200), name: text(place?.name, 120), address: text(place?.address, 220), mapsUrl: text(place?.mapsUrl, 500),
    rating: Number.isFinite(Number(place?.rating)) ? Number(place.rating) : undefined,
    priceLevel: text(place?.priceLevel, 40), weekdayDescriptions: Array.isArray(place?.weekdayDescriptions) ? place.weekdayDescriptions.slice(0, 7).map((item) => text(item, 160)) : [],
  })).filter((place) => place.id && place.name);
  const weather = body.weather && Array.isArray(body.weather.days) ? { area: text(body.weather.area,120), days: body.weather.days.slice(0,7).map(day=>({date:text(day?.date,12),condition:text(day?.condition,30),temperatureMax:Number(day?.temperatureMax),temperatureMin:Number(day?.temperatureMin),precipitationProbability:Number(day?.precipitationProbability),outdoorSuitability:text(day?.outdoorSuitability,12)})) } : null;
  const reusedContext = Array.isArray(body.reusedContext) ? body.reusedContext.slice(0,2).map(item=>({title:text(item?.title,100),summary:text(item?.summary,300),verdict:text(item?.verdict,180),nextSteps:Array.isArray(item?.nextSteps)?item.nextSteps.slice(0,3).map(v=>text(v,120)):[]})) : [];
  return { value: { topic: { id: topicId, title: topicTitle, summary: text(body.topic?.summary, 180) }, profile: compactRecord(body.profile, 20), answers: compactRecord(body.answers, 20), verifiedPlaces: places, weather, reusedContext, externalDataStatus: compactRecord(body.externalDataStatus,4) } };
}

async function generateStrategy(input) {
  const axios = require("axios");
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_NOT_CONFIGURED");
  const topicId = input.topic.id;
  const instructions = [
    "あなたは日本語の恋愛行動プラン作成者です。診断ではなく、実際に行動できる攻略を作ります。断定・操作・過度な期待を避け、相手の意思と安全を尊重してください。",
    "入力された関係段階、双方の傾向、今回の目的に合わせて内容を変えます。入力にない事実は作らないでください。",
    ["date-plan","travel-plan","anniversary"].includes(topicId) ? "現実データが必要な計画です。verifiedPlaces にない店名・施設名、取得していない営業時間・料金・移動時間・空席を作らないでください。候補がない場合は地域と施設種別だけで安全に提案し、公式情報の確認を促してください。weather がある時だけ天気を明示し、天候に合わせて屋内外・順序・移動負担・予備案を実際に変えてください。weather がない時は天気を見たと主張しないでください。" : "旅行・予約・実在店舗情報を勝手に追加しないでください。",
    "headline は今回の具体的な方針。steps は時間順の実行手順。avoid は今やらないこと。reactions は前向き・迷い・反応が薄い場合。checkpoints は次に観察する点。計画系では cautions、backupPlan、budgetNote も具体化し、それ以外は短くしてください。reusedContext は再分析せず必要な結論だけ再利用してください。",
  ].join("\n");
  const model = process.env.OPENAI_STRATEGY_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";
  const response = await axios.post("https://api.openai.com/v1/chat/completions", {
    model, messages: [{ role: "system", content: instructions }, { role: "user", content: JSON.stringify(input) }], temperature: 0.2, max_tokens: 1600,
    response_format: { type: "json_schema", json_schema: strategySchema },
  }, { timeout: 60000, headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" } });
  const raw = String(response.data?.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
  if (!raw) throw new Error("AI_EMPTY_RESPONSE");
  return { result: JSON.parse(raw), model: response.data?.model || model, usage: aiUsageProperties(response, response.data?.model || model, "strategy") };
}

module.exports = { cleanStrategyInput, generateStrategy, strategySchema };
