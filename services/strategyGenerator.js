const { aiUsageProperties } = require("../tracking/cost");
const { localeRules } = require("../prompts/locales");
const { assertLocale } = require("./resultNormalizers");

const strategySchema = {
  name: "renai_strategy_plan",
  strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["headline", "currentSituation", "strategyBasis", "steps", "avoid", "reactions", "checkpoints", "stopConditions", "cautions", "backupPlan", "budgetNote"],
    properties: {
      headline: { type: "string" }, currentSituation: { type: "string" },
      strategyBasis: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
      steps: { type: "array", minItems: 3, maxItems: 5, items: { type: "object", additionalProperties: false, required: ["title", "detail"], properties: { title: { type: "string" }, detail: { type: "string" } } } },
      avoid: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
      reactions: { type: "array", minItems: 3, maxItems: 3, items: { type: "object", additionalProperties: false, required: ["signal", "action"], properties: { signal: { type: "string" }, action: { type: "string" } } } },
      checkpoints: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } },
      stopConditions: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
      cautions: { type: "array", maxItems: 4, items: { type: "string" } },
      backupPlan: { type: "string" }, budgetNote: { type: "string" },
    },
  },
};

const topicMethodology = {
  "get-closer": "Assess present reciprocity, natural contact opportunities, and pressure risk. Build the smallest next step that lets the other person participate voluntarily.",
  "invite-date": "Choose channel, timing, specificity, and an easy opt-out. The invitation must be concrete enough to answer but light enough to decline safely.",
  confess: "Separate affection signals from readiness for a relationship. Choose timing and setting, explain the uncertainty, and include a graceful response path for every answer.",
  clarify: "Define exactly what needs clarification, distinguish a request for mutual understanding from pressure for commitment, and structure a calm two-way conversation.",
  "date-plan": "Turn constraints, verified places, weather, travel load, budget, and desired atmosphere into a realistic sequence with a practical fallback.",
  "travel-plan": "Balance travel time, rest, budget, privacy, safety, and both people's preferences. Avoid over-scheduling and include explicit decision points.",
  anniversary: "Match the plan to relationship stage, meaning of the date, preferred level of surprise, budget, and practical constraints without inventing details.",
  gift: "Infer only from stated preferences and relationship stage. Explain the gift direction, avoid disproportionate cost or intimacy, and include a lower-pressure alternative.",
  conversation: "Use known interests and recent context to create openings, ways to deepen naturally, and signals that indicate whether to continue or change topic.",
  "before-meeting": "Prepare communication, logistics, emotional expectations, boundaries, and a simple day-of sequence with contingencies.",
  refresh: "Identify the repeated pattern without blaming either person, introduce one manageable change, and protect the routines that still work.",
  "time-together": "Design shared time around energy, conversation comfort, preferences, and relationship stage; include both active and quiet options.",
  "make-up": "Separate the trigger from the underlying issue, assign responsibility carefully, restore a talkable state first, and avoid forced resolution.",
  reconciliation: "Assess contact status, breakup cause, demonstrated change, mutual willingness, and safety before any escalation. Stopping conditions are mandatory."
};

const checkpointFocus = {
  "get-closer": "reciprocal conversation length, partner-initiated contact, and whether they help create the next chance to meet",
  "invite-date": "a concrete answer about timing, an alternative date when unavailable, and whether warmth remains after the invitation",
  confess: "whether they engage with the relationship question, ask for a specific next conversation, or clearly set a boundary",
  clarify: "whether they state a concrete relationship preference, name what they need, and follow through consistently afterward",
  "date-plan": "whether they participate in choices during the date, extend shared time voluntarily, and initiate a concrete follow-up afterward",
  "travel-plan": "whether they share planning and adjustment decisions, communicate needs during the trip, and propose another shared experience afterward",
  anniversary: "whether they reciprocate personal reflection, engage with the shared memory, and initiate a future-oriented plan afterward",
  gift: "whether they use or mention the gift naturally, respond without return-pressure, and later reveal more specific preferences",
  conversation: "whether they expand a topic without prompting, ask follow-up questions, and bring a previous thread into a later conversation",
  "before-meeting": "whether they confirm logistics, show relaxed reciprocal engagement in person, and mention or help arrange a next meeting",
  refresh: "whether the new activity changes conversation or cooperation, whether both opt in again, and whether the improvement lasts afterward",
  "time-together": "whether both initiate shared time, communicate energy or space needs directly, and maintain a mutually workable rhythm",
  "make-up": "whether they re-enter the conversation voluntarily, discuss the underlying issue specifically, and follow the new repair agreement later",
  reconciliation: "whether contact becomes mutually initiated, conversation shifts from the breakup toward present life and future possibilities, and resistance to talking or meeting decreases"
};

function assertStrategyDepth(result) {
  const meaningful = value => typeof value === "string" && value.replace(/\s/g, "").length >= 12;
  const titled = value => typeof value === "string" && value.replace(/\s/g, "").length >= 4;
  if (!meaningful(result?.headline) || !meaningful(result?.currentSituation)) throw new Error("AI_SHALLOW_STRATEGY");
  if (!Array.isArray(result.strategyBasis) || result.strategyBasis.length < 2 || result.strategyBasis.some(item => !meaningful(item))) throw new Error("AI_SHALLOW_STRATEGY");
  if (!Array.isArray(result.steps) || result.steps.length < 3 || result.steps.some(step => !titled(step?.title) || !meaningful(step?.detail))) throw new Error("AI_SHALLOW_STRATEGY");
  if (!Array.isArray(result.stopConditions) || result.stopConditions.length < 2 || result.stopConditions.some(item => !meaningful(item))) throw new Error("AI_SHALLOW_STRATEGY");
}

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
  const love=body.userLoveProfile&&typeof body.userLoveProfile==="object"?body.userLoveProfile:null;
  const userLoveProfile=love?{typeCode:text(love.typeCode,4),typeName:text(love.typeName,60),axisScores:compactScores(love.axisScores),behaviorScores:compactScores(love.behaviorScores),axisMeta:compactAxisMeta(love.axisMeta),behaviorConfidence:compactBehaviorConfidence(love.behaviorConfidence),summary:text(love.summary,180),strength:text(love.strength,180),watchout:text(love.watchout,180),strategyFit:text(love.strategyFit,180),completedAt:text(love.completedAt,40)}:null;
  return { value: { topic: { id: topicId, title: topicTitle, summary: text(body.topic?.summary, 180) }, profile: compactRecord(body.profile, 20), userLoveProfile, answers: compactRecord(body.answers, 20), verifiedPlaces: places, weather, reusedContext, externalDataStatus: compactRecord(body.externalDataStatus,4) } };
}

function compactScores(value){return Object.fromEntries(Object.entries(value&&typeof value==="object"?value:{}).slice(0,12).map(([key,score])=>[text(key,30),Math.max(0,Math.min(100,Math.round(Number(score)||0))) ]))}
function compactAxisMeta(value){return Object.fromEntries(Object.entries(value&&typeof value==="object"?value:{}).slice(0,4).map(([key,item])=>[text(key,2),{borderline:Boolean(item?.borderline),confidence:["low","moderate","high"].includes(item?.confidence)?item.confidence:"low",preferredPole:text(item?.preferredPole,1)}]))}
function compactBehaviorConfidence(value){return Object.fromEntries(Object.entries(value&&typeof value==="object"?value:{}).slice(0,8).map(([key,item])=>[text(key,30),{confidence:["low","moderate","high"].includes(item?.confidence)?item.confidence:"low",effectiveQuestions:Math.max(0,Math.min(6,Math.round(Number(item?.effectiveQuestions)||0)))}]))}

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
  const depthContract = `\nTOPIC-SPECIFIC METHOD:\n${topicMethodology[topicId] || "Build the lowest-pressure executable plan supported by the supplied context."}\n\nDEPTH AND EVIDENCE CONTRACT:\n- When the supplied answers and reused context are sufficient, match a premium worked example: state one decisive core strategy, explain 2-4 situation-specific reasons, give chronological steps with concrete timing and behavior, branch for positive/uncertain/weak reactions, identify observable checkpoints, and state explicit conditions for pausing or stopping.\n- Tie every recommendation to an input, a stated preference, the relationship stage, verified external data, or a clearly labelled conditional assumption. Never invent an event, preference, partner feeling, venue, or constraint.\n- currentSituation must distinguish observed/user-provided facts, interpretation, and uncertainty. strategyBasis must explain why this direction fits this user now, rather than restating the headline.\n- Each step detail must say what to do, when or under what condition, and why it is appropriate. Avoid generic filler.\n- If information is partly missing, still produce the richest safe plan supported by what is known, use conditional branches for the unknown part, and make the first step an information-gathering or low-risk action.\n- Only when a useful judgment is genuinely impossible should you foreground missing information; even then provide a bounded low-risk next action.\n- stopConditions are observable boundaries that mean pause, step back, or prioritize safety. backupPlan must be a genuine alternative, not a paraphrase of the main plan.\n- Do not repeat the same advice across headline, basis, steps, checkpoints, and backupPlan.`;
  const checkpointContract = `\nCHECKPOINT CONTRACT:\n- checkpoints are future, observable partner behaviors or responses after the user follows this plan.\n- Every checkpoint must explicitly connect one recommended step in this result to the partner response that would show whether it worked and the decision that response supports.\n- Ground the checkpoints in this topic's focus: ${checkpointFocus[topicId] || "the partner's concrete participation in the exact action recommended by this plan"}.\n- Derive all three checkpoints from the actual topic, relationship stage, relationship duration when supplied, this attempt's goal, recent chat/relationship signals, reused context, and the headline plus steps generated in this same result.\n- Produce exactly three distinct checkpoints: immediate response, partner initiative or concrete follow-through, and the most decision-useful change in a later interaction. The third checkpoint must be newly written for this exact plan, not a relationship label or duration inserted into a reusable sentence.\n- Make each checkpoint specific enough that it would not sensibly fit a different strategy topic or a materially different goal.\n- Do not reuse a stock trio about expanding conversation, proposing a next meeting, and maintaining warmth unless those are independently supported by this topic and input.\n- Never use a product feature, venue condition, price, budget, recommendation, repeated step, generic summary, or an unobservable claim about private feelings as a checkpoint.`;
  const personalizationContract = input.userLoveProfile?.typeCode?`\nUSER LOVE PROFILE:\n- Use behaviorScores as scenario-derived preferences, weighted by behaviorConfidence. A low-confidence behavior is auxiliary context only and must never drive a strong recommendation by itself.\n- Read axisMeta before using axisScores. When borderline is true or confidence is low, treat both poles as plausible and do not describe that axis as a clear preference.\n- Adapt pacing, directness, planning detail, novelty, reassurance, ritual, and conflict timing only when the relevant signal has enough confidence and is relevant to this topic. ritual and conflictImmediate currently have only two effective questions, so treat them as low-confidence auxiliary signals.\n- Never infer one behavior from an unrelated MBTI-style axis (for example, low initiative does not prove slow warming).\n- Never output a fixed strategy merely because of typeCode ${input.userLoveProfile.typeCode}; current facts and observed signals take priority.\n- Mention the profile only when it explains a concrete recommendation; avoid psychological certainty.`:"";
  const instructions = `${localizedInstructions[locale] || localizedInstructions.ja}${personalizationContract}${checkpointContract}${depthContract}\n${localeRules(locale)}`;
  const model = process.env.OPENAI_STRATEGY_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";
  let response, result, lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await axios.post("https://api.openai.com/v1/chat/completions", {
        model, messages: [{ role: "system", content: instructions }, { role: "user", content: `${JSON.stringify(input)}${attempt ? "\nThe previous draft failed the depth contract. Return a complete, non-repetitive strategy grounded only in this input." : ""}` }], temperature: attempt ? 0 : 0.2, max_tokens: 2600,
        response_format: { type: "json_schema", json_schema: strategySchema },
      }, { timeout: 60000, headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" } });
      const raw = String(response.data?.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
      if (!raw) throw new Error("AI_EMPTY_RESPONSE");
      result = JSON.parse(raw);
      assertStrategyDepth(result);
      assertLocale([
        result.headline, result.currentSituation,
        ...(result.steps || []).flatMap((item) => [item?.title, item?.detail]),
        ...(result.avoid || []),
        ...(result.reactions || []).flatMap((item) => [item?.signal, item?.action]),
        ...(result.strategyBasis || []), ...(result.checkpoints || []), ...(result.stopConditions || []), ...(result.cautions || []),
        result.backupPlan, result.budgetNote,
      ], locale);
      break;
    } catch (error) { lastError = error; }
  }
  if (!result || !response) throw lastError || new Error("AI_FAILED");
  return { result, model: response.data?.model || model, usage: aiUsageProperties(response, response.data?.model || model, "strategy") };
}

module.exports = { cleanStrategyInput, generateStrategy, strategySchema };
