const { aiUsageProperties } = require("../tracking/cost");
const { localeRules } = require("../prompts/locales");
const { assertLocale } = require("./resultNormalizers");

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

async function generateStrategy(input, locale = "ja") {
  const axios = require("axios");
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_NOT_CONFIGURED");
  const topicId = input.topic.id;
  const needsRealData = ["date-plan","travel-plan","anniversary"].includes(topicId);
  const localizedInstructions = {
    ja: `診断ではなく、現在の関係、ふたりの好み、今回の目的に合う実行可能な恋愛攻略を作成してください。同意、境界線、安全を尊重し、操作や本心の断定、入力にない事実を避けます。${needsRealData ? "実在する店名、住所、営業時間、価格、経路、空き状況、天気を創作してはいけません。店名はverifiedPlacesにあるものだけを使い、候補がなければ安全な施設の種類とエリアを提案して公式情報の確認を促してください。weatherがある場合だけ天気に触れ、屋内外の選択、順序、徒歩負担、代替案に反映してください。" : "旅行、予約、店舗、価格、経路などの現実情報を創作しないでください。"} headlineはこの状況の具体的な方向性、stepsは時系列で実行できる内容、avoidは今しないこと、reactionsは前向き・曖昧・弱い反応への対応、checkpointsは次に見る兆候です。reusedContextは再分析せず、関係する結論だけを活用してください。`,
    "zh-TW": `請產生能實際執行、並理解雙方關係的行動攻略，而不是做診斷。內容要配合目前關係階段、兩人的偏好與這次目標；尊重同意、界線與安全，不操控、不斷言對方內心，也不加入輸入中沒有的事實。${needsRealData ? "不得編造店家、地址、營業時間、價格、路線、空位或天氣。只能使用 verifiedPlaces 中的店名；若沒有可靠地點，請改以合適的場所類型與區域提出建議，並提醒使用者查核官方資訊。只有提供 weather 時才能提及天氣，而且要真正影響室內外選擇、行程順序、步行負擔與備案。" : "不得編造旅遊、預約、店家、價格、路線等現實資訊。"} headline 要直接說明這次的策略方向；steps 依時間順序且可以執行；avoid 說明目前不適合做的事；reactions 分別處理正向、模糊與冷淡反應；checkpoints 說明接下來要觀察的訊號。請直接沿用 reusedContext 中相關的既有結論，不要重新分析同一批資料。`,
    en: `Create a practical, relationship-aware action plan rather than a diagnosis. Adapt it to the stated relationship stage, both people's preferences, and the user's goal. Respect consent, boundaries, and safety; avoid manipulation, certainty about private feelings, and facts not present in the input. ${needsRealData ? "Never invent a venue, address, opening hours, price, route, availability, or weather. Name only venues in verifiedPlaces. If none are available, recommend suitable venue categories and an area, and tell the user to verify official details. Mention weather only when weather data is supplied, and make it affect indoor/outdoor choices, sequence, walking load, and the backup plan." : "Do not invent travel, booking, venue, price, route, or other real-world details."} headline states the concrete direction; steps are chronological and executable; avoid covers what not to do now; reactions handles positive, uncertain, and weak responses; checkpoints identifies the next signals to watch. Reuse relevant conclusions from reusedContext without re-analyzing the same material.`,
  };
  const instructions = `${localizedInstructions[locale] || localizedInstructions.ja}\n${localeRules(locale)}`;
  const model = process.env.OPENAI_STRATEGY_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";
  const response = await axios.post("https://api.openai.com/v1/chat/completions", {
    model, messages: [{ role: "system", content: instructions }, { role: "user", content: JSON.stringify(input) }], temperature: 0.2, max_tokens: 1600,
    response_format: { type: "json_schema", json_schema: strategySchema },
  }, { timeout: 60000, headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" } });
  const raw = String(response.data?.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
  if (!raw) throw new Error("AI_EMPTY_RESPONSE");
  const result = JSON.parse(raw);
  assertLocale([
    result.headline, result.currentSituation,
    ...(result.steps || []).flatMap((item) => [item?.title, item?.detail]),
    ...(result.avoid || []),
    ...(result.reactions || []).flatMap((item) => [item?.signal, item?.action]),
    ...(result.checkpoints || []), ...(result.cautions || []),
    result.backupPlan, result.budgetNote,
  ], locale);
  return { result, model: response.data?.model || model, usage: aiUsageProperties(response, response.data?.model || model, "strategy") };
}

module.exports = { cleanStrategyInput, generateStrategy, strategySchema };
