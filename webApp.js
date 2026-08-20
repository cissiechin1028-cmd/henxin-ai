require("dotenv").config();

const express = require("express");
const { constructStripeWebhookEvent, shouldApplyStripeBusinessEffects, webhookSecretCandidates } = require("./services/stripeWebhook");
const Stripe = require("stripe");
const axios = require("axios");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { analyzeForWeb, analyzeConversationForWeb, analyzeConversationTopicForWeb } = require("./services/webAnalysis");
const { aiUsageProperties } = require("./tracking/cost");
const { generateRelationshipReport, periodBounds } = require("./services/relationshipReports");
const { createTracking } = require("./tracking/service");
const { normalizeModule, moduleOverview, moduleFunnel, moduleCosts, aiUsageSummary, operationalEvents: filterOperationalEvents } = require("./tracking/analytics");
const { createUsageService } = require("./services/usageService");
const { getAnalysisTopic } = require("./analysisTopics");
const { cleanStrategyInput, generateStrategy } = require("./services/strategyGenerator");
const { localeRules } = require("./prompts/locales");

const app = express();
app.set("trust proxy", 1);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_placeholder");
const port = Number(process.env.PORT || 3001);
const allowedOrigins = String(process.env.WEB_APP_ORIGINS || "http://localhost:3000")
  .split(",").map((value) => value.trim()).filter(Boolean);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);
const tracking = createTracking({ supabase });
const usageService = createUsageService({ supabase });
const dashboardStatsStartAt = new Date(process.env.ADMIN_STATS_START_AT || "2026-08-01T10:00:00.000Z").toISOString();

const chatExtractionSchema = {
  name: "renai_chat_extraction",
  strict: true,
  schema: {
    type: "object", additionalProperties: false, required: ["messages"],
    properties: { messages: { type: "array", maxItems: 200, items: {
      type: "object", additionalProperties: false, required: ["sender", "text", "timestamp"],
      properties: {
        sender: { type: "string", enum: ["self", "partner"] },
        text: { type: "string", minLength: 1, maxLength: 1000 },
        timestamp: { type: ["string", "null"], maxLength: 80 },
      },
    } } },
  },
};

async function extractChatMessages({ imageBuffer, mimeType }) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_NOT_CONFIGURED");
  const model = process.env.OPENAI_EXTRACTION_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";
  let last = { messages: [], response: null };
  for (let pass = 0; pass < 2; pass += 1) {
    const response = await axios.post("https://api.openai.com/v1/chat/completions", {
      model,
      messages: [
        { role: "system", content: pass === 0
          ? "Extract only visible chat messages in chronological order. For LINE screenshots, green bubbles aligned to the right are self and white or light-gray bubbles aligned to the left are partner. For other chat apps, determine self versus partner from bubble alignment and UI conventions. Preserve the original message language, emoji, punctuation, and line breaks. For each message, copy its visibly associated date/time label exactly into timestamp (for example 19:53, 昨日 21:04, or 2026/08/10 09:30); use null when no time can be reliably associated. A date divider applies to following messages until the next divider, but never invent a missing date or time. Ignore names, navigation labels, reactions, system notices, stickers without readable text, and invented or uncertain text. Return an empty list if reliable chat messages are not visible."
          : "Re-check the entire screenshot carefully. Treat every readable green bubble on the RIGHT as self and every readable white/light-gray bubble on the LEFT as partner. Read both columns from top to bottom, including short messages. Do not omit a side merely because its bubbles are smaller. Return visible message text in chronological order and preserve each reliably associated visible date/time label in timestamp. Use null rather than guessing when a message has no readable time. Ignore unrelated UI labels." },
        { role: "user", content: [
          { type: "text", text: pass === 0 ? "Convert this chat screenshot into editable message bubbles." : "The first pass missed messages or one speaker. Carefully extract both left and right chat bubbles." },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBuffer.toString("base64")}`, detail: "high" } },
        ] },
      ],
      temperature: 0, max_tokens: 2400,
      response_format: { type: "json_schema", json_schema: chatExtractionSchema },
    }, { timeout: 60000, headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" } });
    const raw = JSON.parse(String(response.data?.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim());
    const messages = Array.isArray(raw?.messages) ? raw.messages.slice(-200).map((message) => ({
      sender: message?.sender === "self" ? "self" : "partner",
      text: String(message?.text || "").trim().slice(0, 1000),
      timestamp: message?.timestamp == null ? null : String(message.timestamp).trim().slice(0, 80) || null,
    })).filter((message) => message.text) : [];
    last = { messages, response };
    const senders = new Set(messages.map((message) => message.sender));
    if (messages.length && senders.has("self") && senders.has("partner")) break;
  }
  return { messages: last.messages, model: last.response?.data?.model || model, usage: aiUsageProperties(last.response, last.response?.data?.model || model, "chat_extraction") };
}

const consultationTask = {
  ja: "あなたはRenAIの恋愛コミュニケーション相談員です。分析結果とユーザーが明示した事実を根拠に、現代の日本で自然に読める日本語で、簡潔かつ実行しやすい助言を返してください。確認できる事実、ユーザーの申告、解釈を混同せず、相手の本心を断定しないでください。嫌がらせ、監視、操作、強要、望まれない反復連絡、AIへの依存を勧めてはいけません。返信文を求められた場合は、短い案を最大3つまで提示してください。",
  "zh-TW": "你是 RenAI 的感情溝通顧問。請根據分析結果與使用者明確提供的事實，以台灣使用者自然、好理解的繁體中文，給出精簡且能實際採取的建議。請清楚區分可確認的事實、使用者陳述與你的判讀，不要斷言對方內心。不得鼓勵騷擾、監控、操控、施壓、反覆傳送不受歡迎的訊息，或讓使用者依賴助理。若使用者需要回覆訊息，最多提供3個簡短版本。",
  en: "You are RenAI's relationship communication consultant. Use the analysis and the facts the user explicitly provided to give concise, practical advice in natural contemporary English. Keep verified facts, the user's account, and interpretation distinct, and never claim certainty about another person's private feelings. Do not encourage harassment, surveillance, manipulation, coercion, repeated unwanted contact, or dependence on the assistant. If the user asks for a message, offer no more than three short options.",
};

async function createConsultationReply({ locale = "ja", analysisResult = {}, messages = [] }) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_NOT_CONFIGURED");
  const model = process.env.OPENAI_CONSULTATION_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";
  const compactAnalysis = JSON.stringify(analysisResult).slice(0, 8000);
  const response = await axios.post("https://api.openai.com/v1/chat/completions", {
    model,
    messages: [
      { role: "system", content: `${consultationTask[locale] || consultationTask.ja}\n${localeRules(locale)}\nAnalysis context (source data; do not copy its wording mechanically): ${compactAnalysis}` },
      ...messages.slice(-12).map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: String(message.content).slice(0, 1500) })),
    ],
    temperature: 0.3, max_tokens: 700,
  }, { timeout: 60000, headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" } });
  const content = String(response.data?.choices?.[0]?.message?.content || "").trim();
  if (!content) throw new Error("AI_EMPTY_RESPONSE");
  return { content: content.slice(0, 4000), model: response.data?.model || model, usage: aiUsageProperties(response, response.data?.model || model, "ai_consultation") };
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "").trim().toLowerCase()).digest("hex");
}

function anonymousHash(value) {
  const secret = process.env.ANONYMOUS_USAGE_SECRET || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("ANONYMOUS_USAGE_NOT_CONFIGURED");
  return crypto.createHmac("sha256", secret).update(String(value || "")).digest("hex");
}

function networkPrefix(value) {
  const ip = String(value || "unknown").replace(/^::ffff:/, "").trim();
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) return ip.split(".").slice(0, 3).join(".");
  if (ip.includes(":")) return ip.split(":").slice(0, 4).join(":");
  return "unknown";
}

function anonymousIdentity(req) {
  const deviceId = String(req.headers["x-renai-device-id"] || "").trim();
  if (!/^[a-zA-Z0-9_-]{20,128}$/.test(deviceId)) return null;
  const forwardedIp = String(req.headers["cf-connecting-ip"] || req.ip || "unknown").split(",")[0].trim();
  const network = networkPrefix(forwardedIp);
  const userAgent = String(req.headers["user-agent"] || "").slice(0, 500);
  const language = String(req.headers["accept-language"] || "").slice(0, 120);
  const fingerprint = String(req.headers["x-renai-fingerprint"] || "").slice(0, 500);
  return {
    deviceHash: anonymousHash(`device:${deviceId}`),
    riskHash: anonymousHash(`risk:${network}:${userAgent}:${language}:${fingerprint}`),
    networkHash: anonymousHash(`network:${network}`),
  };
}

function subscriptionPeriod(subscription) {
  const item = subscription?.items?.data?.[0];
  return {
    start: subscription?.current_period_start || item?.current_period_start || null,
    end: subscription?.current_period_end || item?.current_period_end || null
  };
}

const BILLING_TIERS = Object.freeze({
  lite: { replyLimit: 50, combinedLimit: 10, strategyLimit: 10 },
  premium: { replyLimit: 150, combinedLimit: 30, strategyLimit: 30 },
});

const BILLING_MARKETS = Object.freeze({
  JP: { currency: "jpy", lite: { env: "STRIPE_LITE_PRICE_ID", unitAmount: 680 }, premium: { env: "STRIPE_PREMIUM_PRICE_ID", unitAmount: 1280 } },
  US: { currency: "usd", lite: { env: "STRIPE_US_LITE_PRICE_ID", unitAmount: 699 }, premium: { env: "STRIPE_US_PREMIUM_PRICE_ID", unitAmount: 1299 } },
  TW: { currency: "twd", lite: { env: "STRIPE_TW_LITE_PRICE_ID", unitAmount: 16900 }, premium: { env: "STRIPE_TW_PREMIUM_PRICE_ID", unitAmount: 32900 } },
  HK: { currency: "hkd", lite: { env: "STRIPE_HK_LITE_PRICE_ID", unitAmount: 4200 }, premium: { env: "STRIPE_HK_PREMIUM_PRICE_ID", unitAmount: 8200 } },
});

function stripePriceIdForTier(tier, market = "JP") {
  const definition = BILLING_MARKETS[market]?.[tier];
  if (!definition) return null;
  return process.env[definition.env] || (market === "JP" && tier === "premium" ? process.env.STRIPE_PRICE_ID : null) || null;
}

function billingTierForSubscription(subscription, fallback = "premium") {
  const priceId = subscription?.items?.data?.[0]?.price?.id;
  if (subscription?.metadata?.tier && BILLING_TIERS[subscription.metadata.tier]) return subscription.metadata.tier;
  if (priceId && Object.keys(BILLING_MARKETS).some(market => priceId === stripePriceIdForTier("lite", market))) return "lite";
  if (priceId && Object.keys(BILLING_MARKETS).some(market => priceId === stripePriceIdForTier("premium", market))) return "premium";
  return fallback;
}

async function reservePaidFeature(userId, tier, feature) {
  const limits = BILLING_TIERS[tier] || BILLING_TIERS.premium;
  const limit = feature === "reply" ? limits.replyLimit : feature === "strategy" ? limits.strategyLimit : limits.combinedLimit;
  const { data, error } = await supabase.rpc("reserve_paid_feature_usage", {
    target_user_id: userId, target_feature: feature, target_limit: limit,
  });
  if (error) throw new Error("PAID_FEATURE_USAGE_FAILED");
  return data?.[0] || { allowed: false, used: limit, usage_limit: limit };
}

async function refundPaidFeature(userId, feature) {
  const { error } = await supabase.rpc("refund_paid_feature_usage", { target_user_id: userId, target_feature: feature });
  if (error) console.error("PAID_FEATURE_REFUND_FAILED", error.message);
}

function invoiceSubscriptionId(invoice) {
  const value = invoice?.subscription
    || invoice?.parent?.subscription_details?.subscription
    || invoice?.lines?.data?.[0]?.parent?.subscription_item_details?.subscription;
  return typeof value === "string" ? value : value?.id || null;
}

async function requireProfileUpdate(userId, update) {
  const { data, error } = await supabase.from("profiles").update(update).eq("id", userId).select("id").maybeSingle();
  if (error) throw new Error(`PROFILE_UPDATE_FAILED:${error.message}`);
  if (!data?.id) throw new Error("PROFILE_UPDATE_FAILED:PROFILE_NOT_FOUND");
}

async function sendTikTokPurchase({ eventId, userId, email, amount, currency }) {
  const pixelId = process.env.TIKTOK_PIXEL_ID;
  const token = process.env.TIKTOK_EVENTS_API_ACCESS_TOKEN;
  if (!pixelId || !token) {
    console.error("TIKTOK_PURCHASE_SKIPPED", "TIKTOK_NOT_CONFIGURED", eventId);
    return { delivered: false, skipped: true };
  }
  const response = await fetch("https://business-api.tiktok.com/open_api/v1.2/pixel/track/", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Access-Token": token },
    body: JSON.stringify({
      pixel_code: pixelId,
      event: "Purchase",
      event_id: eventId,
      timestamp: new Date().toISOString(),
      context: {
        user: {
          ...(email ? { email: sha256(email) } : {}),
          external_id: sha256(userId)
        }
      },
      properties: {
        content_id: "renai_premium_monthly",
        content_name: "RenAI Premium Monthly",
        content_type: "product",
        quantity: 1,
        value: Number(amount || 0) / 100,
        currency: String(currency || "jpy").toUpperCase()
      }
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || Number(result?.code || 0) !== 0) {
    throw new Error(`TIKTOK_PURCHASE_FAILED:${response.status}:${result?.code || "UNKNOWN"}:${result?.message || "UNKNOWN"}`);
  }
  console.log("TIKTOK_PURCHASE_DELIVERED", eventId);
  return { delivered: true };
}

function isSupportedImage(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (mimeType === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (mimeType === "image/webp") return buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
  return false;
}

function normalizeTimelineText(value) {
  return String(value || "").normalize("NFKC").toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function timelineTextSimilarity(left, right) {
  const a = normalizeTimelineText(left);
  const b = normalizeTimelineText(right);
  if (!a || !b) return 0;
  if (a === b || a.includes(b) || b.includes(a)) return 1;
  const bigrams = (value) => {
    if (value.length < 2) return new Set([value]);
    return new Set(Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2)));
  };
  const aa = bigrams(a);
  const bb = bigrams(b);
  let overlap = 0;
  for (const item of aa) if (bb.has(item)) overlap += 1;
  return (2 * overlap) / (aa.size + bb.size);
}

app.disable("x-powered-by");
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Analysis-Mode, X-Locale, X-Reply-Goal, X-Reply-Style, X-Relationship-Status, X-User-Note, X-Analysis-Focus, X-RenAI-Device-ID, X-RenAI-Fingerprint");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(tracking.requestMiddleware);

async function requireUser(req, res, next) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "AUTH_REQUIRED" });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: "INVALID_SESSION" });

  // 自动创建默认 Relationship
  const { data: relationship } = await findActiveRelationship(data.user.id);

if (!relationship) {
  const { error } = await supabase.rpc("switch_relationship", {
    target_user_id: data.user.id,
    archive_current: true,
    new_title: null,
    new_started_on: new Date().toISOString().slice(0, 10)
  });

  if (error) {
    console.error(error);
    return res.status(500).json({ error: "RELATIONSHIP_BOOTSTRAP_FAILED" });
  }
}

  req.user = data.user;
  next();
}

async function requireAdmin(req, res, next) {
  const { data } = await supabase.from("profiles").select("role").eq("id", req.user.id).maybeSingle();
  if (data?.role !== "admin") return res.status(403).json({ error: "ADMIN_REQUIRED" });
  next();
}

const LOVE_TYPE_AXES=["E","I","S","N","T","F","J","P"],LOVE_TYPE_BEHAVIORS=["initiative","slowWarm","directness","securityNeed","planning","novelty","ritual","conflictImmediate"];
const LOVE_TYPE_A_POLES={jp1:"J",ei4:"I",sn2:"S",tf1:"F",ei2:"E",jp4:"P",sn5:"N",tf6:"T",ei6:"I",sn3:"S",jp3:"J",tf2:"F",ei1:"E",sn6:"N",tf5:"T",jp6:"P",ei5:"I",sn1:"S",tf3:"F",ei3:"E",jp2:"J",sn4:"N",tf4:"T",jp5:"P"};
const LOVE_TYPE_OPPOSITES={E:"I",I:"E",S:"N",N:"S",T:"F",F:"T",J:"P",P:"J"},LOVE_TYPE_AXIS_PAIRS={EI:["E","I"],SN:["S","N"],TF:["T","F"],JP:["J","P"]},LOVE_TYPE_TIE_BREAK={EI:"ei2",SN:"sn2",TF:"tf1",JP:"jp1"};
const LOVE_TYPE_BEHAVIOR_MAP={initiative:[["ei1","A"],["ei2","A"],["ei3","A"],["ei5","B"]],slowWarm:[["ei5","A"],["jp5","A"]],directness:[["ei4","B"],["tf6","A"]],securityNeed:[["sn1","B"],["sn5","A"],["jp3","A"],["jp5","B"]],planning:[["jp1","A"],["jp2","A"],["jp3","A"],["jp4","B"],["jp6","B"]],novelty:[["sn6","A"],["jp2","B"],["jp6","A"]],ritual:[["sn3","B"],["jp4","B"]],conflictImmediate:[["tf1","B"],["tf2","B"]]};
function withLoveTypeRuntimeMeta(profile){
 if(!profile||!profile.answers||Object.keys(profile.answers).length!==24)return profile;
 const counts={E:0,I:0,S:0,N:0,T:0,F:0,J:0,P:0},selected=(id,answer)=>answer==="A"?LOVE_TYPE_A_POLES[id]:LOVE_TYPE_OPPOSITES[LOVE_TYPE_A_POLES[id]];
 for(const[id,answer]of Object.entries(profile.answers)){const pole=selected(id,answer);if(pole)counts[pole]++}
 const axisScores=Object.fromEntries(LOVE_TYPE_AXES.map(pole=>[pole,Math.round(counts[pole]/6*100)])),axisMeta={};
 for(const[axis,[first,second]]of Object.entries(LOVE_TYPE_AXIS_PAIRS)){const borderline=counts[first]===counts[second],preferredPole=borderline?selected(LOVE_TYPE_TIE_BREAK[axis],profile.answers[LOVE_TYPE_TIE_BREAK[axis]]):(counts[first]>counts[second]?first:second);axisMeta[axis]={borderline,confidence:borderline?"low":Math.abs(axisScores[first]-axisScores[second])>=66?"high":"moderate",preferredPole}}
 const behaviorScores={},behaviorConfidence={};
 for(const[key,mapping]of Object.entries(LOVE_TYPE_BEHAVIOR_MAP)){const effective=mapping.filter(([id])=>profile.answers[id]);behaviorScores[key]=effective.length?Math.round(effective.filter(([id,high])=>profile.answers[id]===high).length/effective.length*100):50;behaviorConfidence[key]={effectiveQuestions:effective.length,confidence:effective.length<=2?"low":effective.length<=3?"moderate":"high"}}
 return{...profile,axisScores,behaviorScores,axisMeta,behaviorConfidence};
}
function cleanScoreMap(value,keys){if(!value||typeof value!=="object")return null;const result={};for(const key of keys){const score=Number(value[key]);if(!Number.isFinite(score)||score<0||score>100)return null;result[key]=Math.round(score)}return result}
function cleanLoveTypeInput(body={}){
 const typeCode=String(body.typeCode||"").toUpperCase(),typeName=String(body.typeName||"").trim().slice(0,80);
 if(!/^[EI][SN][TF][JP]$/.test(typeCode)||!typeName)return{error:"INVALID_LOVE_TYPE"};
 const axisScores=cleanScoreMap(body.axisScores,LOVE_TYPE_AXES),behaviorScores=cleanScoreMap(body.behaviorScores,LOVE_TYPE_BEHAVIORS);
 if(!axisScores||!behaviorScores)return{error:"INVALID_LOVE_TYPE_SCORES"};
 const answers=body.answers&&typeof body.answers==="object"?Object.fromEntries(Object.entries(body.answers).slice(0,24).filter(([key,value])=>/^(ei|sn|tf|jp)[1-6]$/.test(key)&&(value==="A"||value==="B"))):{};
 if(Object.keys(answers).length!==24)return{error:"INCOMPLETE_LOVE_TYPE"};
 return{value:{version:1,typeCode,typeName,axisScores,behaviorScores,answers,summary:String(body.summary||"").trim().slice(0,240),strength:String(body.strength||"").trim().slice(0,240),watchout:String(body.watchout||"").trim().slice(0,240),strategyFit:String(body.strategyFit||"").trim().slice(0,240),completedAt:new Date().toISOString()}};
}
function mapLoveTypeProfile(row){return row?{version:1,typeCode:row.type_code,typeName:row.type_name,axisScores:row.axis_scores||{},behaviorScores:row.behavior_scores||{},answers:row.answers||{},summary:row.summary||"",strength:row.strength||"",watchout:row.watchout||"",strategyFit:row.strategy_fit||"",completedAt:row.completed_at}:null}

function cleanTimelineInput(body = {}, partial = false) {
  const result = {};
  if (!partial || Object.prototype.hasOwnProperty.call(body, "title")) {
    const title = String(body.title || "").trim();
    if (!title || title.length > 120) return { error: "INVALID_EVENT_TITLE" };
    result.title = title;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, "eventDate")) {
    const eventDate = String(body.eventDate || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || Number.isNaN(Date.parse(`${eventDate}T00:00:00Z`))) {
      return { error: "INVALID_EVENT_DATE" };
    }
    result.event_date = eventDate;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, "eventType")) {
    const eventType = String(body.eventType || "custom").trim();
    if (!eventType || eventType.length > 64) return { error: "INVALID_EVENT_TYPE" };
    result.event_type = eventType;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, "note")) {
    const note = body.note == null ? null : String(body.note).trim();
    if (note && note.length > 2000) return { error: "EVENT_NOTE_TOO_LONG" };
    result.note = note || null;
  }
  return { value: result };
}

async function findOwnedRelationship(userId, relationshipId) {
  return supabase.from("relationships").select("*")
    .eq("id", relationshipId).eq("user_id", userId).maybeSingle();
}

async function findActiveRelationship(userId) {
  return supabase.from("relationships").select("id")
    .eq("user_id", userId).eq("status", "active").maybeSingle();
}

app.get("/health", (_req, res) => res.json({
  ok: true,
  service: "renai-web-api",
  extractionContract: "v2-timestamps",
  release: process.env.RENDER_GIT_COMMIT || null,
}));

function cleanReplySettings(req) {
  const replyGoal = String(req.headers["x-reply-goal"] || "").trim().slice(0, 150);
  const replyStyle = String(req.headers["x-reply-style"] || "natural").trim();
  const relationshipStatus = String(req.headers["x-relationship-status"] || "").trim();
  const userNote = String(req.headers["x-user-note"] || "").trim().slice(0, 300);
  const analysisFocus = String(req.headers["x-analysis-focus"] || "full").trim();
  const styleAliases = { reassure: "gentle" };
  const statusAliases = { unknown: "", crush: "interested", talking: "in_contact", pre_relationship: "in_contact", cold: "", conflict: "", breakup: "ex", reconciliation: "ex" };
  const allowedGoals = new Set(["", "continue_conversation", "get_closer", "understand_feelings", "clear_misunderstanding", "make_up", "lead_to_date", "express_feelings", "decline_politely"]);
  const allowedStyles = new Set(["natural", "get_closer", "gentle", "humor", "amaeru", "honest", "distance"]);
  const allowedStatuses = new Set(["", "interested", "in_contact", "dating", "long_term", "ex"]);
  const allowedAnalysisFocus = new Set(["full", "feelings", "trend", "risk", "next_action"]);
  const normalizedStyle = styleAliases[replyStyle] || replyStyle;
  const normalizedStatus = statusAliases[relationshipStatus] ?? relationshipStatus;
  return {
    value: {
      replyGoal: allowedGoals.has(replyGoal) ? replyGoal : "",
      replyStyle: allowedStyles.has(normalizedStyle) ? normalizedStyle : "natural",
      relationshipStatus: allowedStatuses.has(normalizedStatus) ? normalizedStatus : "",
      userNote,
      analysisFocus: allowedAnalysisFocus.has(analysisFocus) ? analysisFocus : "full",
    }
  };
}

app.post("/api/v1/tracking/page-view", express.json({ limit: "8kb" }), async (req, res) => {
  const anonymousId = String(req.body?.anonymousId || "").trim();
  const occurrenceId = String(req.body?.occurrenceId || "").trim();
  const path = String(req.body?.path || "").trim();
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(anonymousId) || !/^[a-zA-Z0-9_-]{16,100}$/.test(occurrenceId)) {
    return res.status(400).json({ error: "INVALID_TRACKING_ID" });
  }
  if (!["/", "/app"].includes(path)) return res.status(400).json({ error: "INVALID_TRACKING_PATH" });
  const event = await tracking.record({
    name: "page_viewed", businessKey: `page_viewed:${occurrenceId}`,
    anonymousId, source: "browser", properties: { path }
  });
  res.status(202).json({ eventId: event?.event_id || null });
});

const browserEventNames = new Set([
  "free_trial_clicked", "free_trial_cta_clicked", "app_session_start", "anonymous_session_created", "login_opened", "google_login_succeeded", "line_login_succeeded",
  "google_login_clicked", "line_login_clicked", "email_input_started",
  "email_login_succeeded", "google_login_failed", "line_login_failed", "email_otp_failed",
  "first_screenshot_uploaded", "upgrade_clicked", "stripe_checkout_opened", "attribution_linked",
  "module_home_viewed", "module_item_selected", "module_generation_started"
]);
const attributionFields = ["source", "medium", "campaign", "campaign_id", "ad_group", "ad_group_id", "ad", "ad_id", "creative_id", "utm_content", "utm_term", "placement", "ttclid", "landing_page", "captured_at"];
async function storeFirstTouchAttribution(userId, anonymousId, properties = {}) {
  const attribution = Object.fromEntries(attributionFields.map((field) => [field, properties[field]])
    .filter(([, value]) => typeof value === "string" && value.trim()));
  if (!Object.keys(attribution).length) return;
  const { data: profile } = await supabase.from("profiles").select("role,is_test_account").eq("id", userId).maybeSingle();
  if (profile?.role === "admin" || profile?.is_test_account) return;
  const { error } = await supabase.from("user_ad_attributions").upsert({
    user_id: userId, anonymous_id: anonymousId || null, ...attribution
  }, { onConflict: "user_id", ignoreDuplicates: true });
  if (error && error.code !== "23505" && error.code !== "42P01") console.error("ATTRIBUTION STORE FAILED", error.message);
}
app.post("/api/v1/tracking/event", express.json({ limit: "8kb" }), async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const occurrenceId = String(req.body?.occurrenceId || "").trim();
  const anonymousId = String(req.body?.anonymousId || "").trim();
  if (!browserEventNames.has(name) || !/^[a-zA-Z0-9_-]{16,120}$/.test(occurrenceId)) {
    return res.status(400).json({ error: "INVALID_TRACKING_EVENT" });
  }
  let userId = null;
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (token) userId = (await supabase.auth.getUser(token)).data?.user?.id || null;
  if (userId) await storeFirstTouchAttribution(userId, anonymousId || null, req.body?.properties || {});
  const event = await tracking.record({
    name, businessKey: `${name}:${occurrenceId}`, userId,
    anonymousId: anonymousId || null, source: "browser", properties: req.body?.properties || {}
  });
  res.status(202).json({ eventId: event?.event_id || null });
});

function webAppReturnUrl(req) {
  const requestedReturnUrl = String(req.body?.returnUrl || "").trim();
  if (requestedReturnUrl) {
    try {
      const requested = new URL(requestedReturnUrl);
      const normalizedPath = requested.pathname.replace(/\/$/, "");
      if (allowedOrigins.includes(requested.origin) && normalizedPath === "/app") {
        return `${requested.origin}/app`;
      }
    } catch {
      // Ignore malformed return URLs and fall back to the verified request origin.
    }
  }
  const requestOrigin = String(req.headers.origin || "").replace(/\/$/, "");
  const origin = allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];
  return `${origin}/app`;
}

app.get("/api/v1/me", requireUser, async (req, res) => {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", req.user.id).single();
  if (error) return res.status(500).json({ error: "PROFILE_READ_FAILED" });
  res.json({ profile: data });
});

app.get("/api/v1/love-type-profile",requireUser,async(req,res)=>{
 const{data,error}=await supabase.from("love_type_profiles").select("*").eq("user_id",req.user.id).maybeSingle();
 if(error)return res.status(500).json({error:"LOVE_TYPE_READ_FAILED"});
 return res.json({profile:mapLoveTypeProfile(data)});
});

app.put("/api/v1/love-type-profile",requireUser,express.json({limit:"32kb"}),async(req,res)=>{
 const cleaned=cleanLoveTypeInput(req.body);if(cleaned.error)return res.status(400).json({error:cleaned.error});
 const value=cleaned.value,{data,error}=await supabase.from("love_type_profiles").upsert({user_id:req.user.id,version:value.version,type_code:value.typeCode,type_name:value.typeName,axis_scores:value.axisScores,behavior_scores:value.behaviorScores,answers:value.answers,summary:value.summary,strength:value.strength,watchout:value.watchout,strategy_fit:value.strategyFit,completed_at:value.completedAt,updated_at:new Date().toISOString()},{onConflict:"user_id"}).select("*").single();
 if(error)return res.status(500).json({error:"LOVE_TYPE_SAVE_FAILED"});
 await tracking.record({name:"love_type_saved",businessKey:`love_type_saved:${req.user.id}:${value.completedAt}`,userId:req.user.id,source:"api",properties:{module:"strategy",type_code:value.typeCode}}).catch(()=>null);
 return res.json({profile:mapLoveTypeProfile(data)});
});

app.post("/api/v1/billing/checkout", requireUser, express.json(), async (req, res) => {
  const tier = String(req.body?.tier || "premium");
  const market = String(req.body?.market || "").toUpperCase();
  if (!BILLING_MARKETS[market]) return res.status(400).json({ error: "INVALID_BILLING_MARKET" });
  const priceId = stripePriceIdForTier(tier, market);
  if (!BILLING_TIERS[tier]) return res.status(400).json({ error: "INVALID_BILLING_TIER" });
  if (!process.env.STRIPE_SECRET_KEY || !priceId) return res.status(503).json({ error: "BILLING_MARKET_NOT_CONFIGURED", market, tier });
  const expected = BILLING_MARKETS[market];
  let stripePrice;
  try {
    stripePrice = await stripe.prices.retrieve(priceId);
  } catch (error) {
    console.error("BILLING_PRICE_LOOKUP_FAILED", { market, tier, priceId, message: error?.message });
    return res.status(503).json({ error: "BILLING_PRICE_LOOKUP_FAILED", market, tier });
  }
  if (stripePrice.currency !== expected.currency || stripePrice.unit_amount !== expected[tier].unitAmount || stripePrice.recurring?.interval !== "month") {
    console.error("BILLING_PRICE_MISMATCH", { market, tier, priceId, currency: stripePrice.currency, unitAmount: stripePrice.unit_amount, interval: stripePrice.recurring?.interval });
    return res.status(503).json({ error: "BILLING_PRICE_MISMATCH", market, tier });
  }
  const { data: profile } = await supabase.from("profiles").select("stripe_customer_id,plan").eq("id", req.user.id).single();
  if (profile?.plan === "pro") return res.status(409).json({ error: "ALREADY_PRO" });
  const returnUrl = webAppReturnUrl(req);
  const checkoutLocale = { ja: "ja", "zh-TW": "zh-TW", en: "en" }[String(req.body?.locale || "")] || "ja";
  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    locale: checkoutLocale,
    customer: profile?.stripe_customer_id || undefined,
    customer_email: profile?.stripe_customer_id ? undefined : req.user.email,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${returnUrl}?checkout=success`,
    cancel_url: `${returnUrl}?checkout=cancelled`,
    client_reference_id: req.user.id,
    metadata: { userId: req.user.id, tier, market },
    subscription_data: { metadata: { userId: req.user.id, tier, market } },
    allow_promotion_codes: true
  });
  await tracking.record({
    name: "checkout_started", businessKey: `checkout_started:${checkout.id}`,
    userId: req.user.id, source: "stripe", properties: { plan: tier, market, currency: expected.currency }
  });
  res.json({ url: checkout.url });
});

app.post("/api/v1/billing/portal", requireUser, express.json(), async (req, res) => {
  const { data: profile } = await supabase.from("profiles").select("stripe_customer_id").eq("id", req.user.id).single();
  if (!profile?.stripe_customer_id) return res.status(404).json({ error: "BILLING_ACCOUNT_NOT_FOUND" });
  const portalLocale = { ja: "ja", "zh-TW": "zh-TW", en: "en" }[String(req.body?.locale || "")] || "ja";
  const portal = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: webAppReturnUrl(req),
    locale: portalLocale
  });
  res.json({ url: portal.url });
});

const stripeWebhookRaw = express.raw({ type: "application/json" });
async function handleStripeWebhook(req, res) {
  let event;
  try {
    ({ event } = constructStripeWebhookEvent(stripe, req.body, req.headers["stripe-signature"]));
  } catch {
    // Public webhook URLs are routinely probed by bots and uptime scanners. A
    // request without Stripe's signature is not a failed Stripe delivery.
    if (req.headers["stripe-signature"]) {
      console.error("STRIPE_WEBHOOK_SIGNATURE_FAILED", JSON.stringify({
        signaturePresent: true,
        contentType: String(req.headers["content-type"] || ""),
        bodyType: Buffer.isBuffer(req.body) ? "buffer" : typeof req.body,
        bodyLength: Buffer.isBuffer(req.body) ? req.body.length : 0,
        candidates: webhookSecretCandidates().map(({ mode, secret }) => ({
          mode, configured: true, validPrefix: secret.startsWith("whsec_"), length: secret.length
        }))
      }));
      await tracking.record({ name: "stripe_webhook_failed", businessKey: `stripe_webhook_failed:${Date.now()}:${Math.random()}`, source: "stripe", properties: { error_code: "INVALID_SIGNATURE" } });
    }
    return res.status(400).send("Invalid signature");
  }
  const object = event.data.object;
  const userId = object.metadata?.userId || object.client_reference_id || null;
  const applyBusinessEffects = shouldApplyStripeBusinessEffects(event);
  const { error: eventInsertError } = await supabase.from("subscription_events").insert({
    // Sandbox webhooks share this service but must never mutate or reference
    // Production customer records.
    user_id: applyBusinessEffects ? userId : null,
    stripe_event_id: event.id,
    event_type: event.type,
    payload: { object_id: object.id, created: event.created, livemode: event.livemode === true }
  });
  if (eventInsertError && eventInsertError.code !== "23505") {
    return res.status(500).json({ error: "EVENT_STORE_FAILED" });
  }
  if (eventInsertError?.code === "23505") {
    return res.json({ received: true, duplicate: true });
  }
  if (!applyBusinessEffects) {
    return res.json({ received: true, processed: true, testMode: true });
  }
  try {
    if (event.type === "checkout.session.completed" && userId && object.payment_status === "paid") {
      const subscriptionId = typeof object.subscription === "string" ? object.subscription : object.subscription?.id;
      const subscription = subscriptionId ? await stripe.subscriptions.retrieve(subscriptionId) : null;
      const period = subscriptionPeriod(subscription);
      const billingTier = billingTierForSubscription(subscription, object.metadata?.tier || "premium");
      await requireProfileUpdate(userId, {
        plan: "pro", billing_tier: billingTier, stripe_customer_id: object.customer, stripe_subscription_id: subscriptionId,
        subscription_status: subscription?.status || "active", pro_period_usage: 0,
        pro_period_start: period.start ? new Date(period.start * 1000).toISOString() : new Date().toISOString(),
        pro_period_end: period.end ? new Date(period.end * 1000).toISOString() : null
      });
      try {
        await sendTikTokPurchase({
          eventId: `stripe_subscription_${object.subscription || object.id}`,
          userId,
          email: object.customer_details?.email || object.customer_email,
          amount: object.amount_total,
          currency: object.currency
        });
      } catch (error) {
        // Payment and membership are authoritative. Tracking is retried by invoice.paid.
        console.error(String(error.message || error));
      }
    }
    if (["invoice.paid", "invoice.payment_failed"].includes(event.type)) {
    const invoice = object;
    const subscriptionId = invoiceSubscriptionId(invoice);
    const subscription = subscriptionId ? await stripe.subscriptions.retrieve(subscriptionId) : null;
    const invoiceUserId = subscription?.metadata?.userId || userId;
    const price = subscription?.items?.data?.[0]?.price;
    const billingTier = billingTierForSubscription(subscription);
    const recurring = price?.recurring;
    const monthlyMinor = price?.unit_amount == null ? 0
      : recurring?.interval === "year" ? Math.round(price.unit_amount / 12)
        : recurring?.interval === "month" ? Math.round(price.unit_amount / Math.max(1, recurring.interval_count || 1)) : 0;
    if (event.type === "invoice.paid" && invoiceUserId) {
      const first = invoice.billing_reason === "subscription_create";
      const period = subscriptionPeriod(subscription);
      await requireProfileUpdate(invoiceUserId, {
        plan: "pro", billing_tier: billingTier, stripe_customer_id: invoice.customer, stripe_subscription_id: subscriptionId,
        subscription_status: subscription?.status || "active", pro_period_usage: 0,
        pro_period_start: period.start ? new Date(period.start * 1000).toISOString() : new Date().toISOString(),
        pro_period_end: period.end ? new Date(period.end * 1000).toISOString() : null
      });
      await tracking.record({
        name: first ? "subscription_started" : "subscription_renewed",
        businessKey: `${first ? "subscription_started" : "subscription_renewed"}:${first ? invoice.subscription : invoice.id}`,
        userId: invoiceUserId, source: "stripe",
        properties: { currency: String(invoice.currency || price?.currency || "jpy").toUpperCase(), mrr_minor: monthlyMinor, revenue_minor: invoice.amount_paid || 0, invoice_reason: invoice.billing_reason }
      });
      await tracking.record({
        name: "user_plan_snapshot", businessKey: `user_plan_snapshot:${invoiceUserId}:${event.id}`,
        userId: invoiceUserId, source: "stripe",
        properties: { plan: billingTier, subscription_status: subscription?.status || "active", currency: String(invoice.currency || "jpy").toUpperCase(), mrr_minor: monthlyMinor }
      });
      if (first) {
        try {
          await sendTikTokPurchase({
            eventId: `stripe_subscription_${subscriptionId || invoice.id}`,
            userId: invoiceUserId,
            email: invoice.customer_email,
            amount: invoice.amount_paid,
            currency: invoice.currency
          });
        } catch (error) {
          console.error(String(error.message || error));
        }
      }
    } else if (event.type === "invoice.payment_failed") {
      await tracking.record({
        name: "payment_failed", businessKey: `payment_failed:${invoice.id}`,
        userId: invoiceUserId, source: "stripe", properties: {
          currency: String(invoice.currency || "jpy").toUpperCase(), invoice_reason: invoice.billing_reason,
          error_code: "PAYMENT_FAILED", failure_message: "Stripe invoice payment failed"
        }
      });
    }
    if (event.type === "charge.refunded") {
      await tracking.record({
        name: "payment_refunded", businessKey: `payment_refunded:${object.id}:${object.amount_refunded}`,
        userId, source: "stripe", properties: {
          currency: String(object.currency || "jpy").toUpperCase(), revenue_minor: object.amount_refunded || 0
        }
      });
    }
    }
    if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
    const subscription = object;
    const subscriptionUserId = subscription.metadata?.userId;
    const active = ["active", "trialing"].includes(subscription.status);
    const period = subscriptionPeriod(subscription);
    const billingTier = active ? billingTierForSubscription(subscription) : "free";
    const update = {
      plan: active ? "pro" : "free", billing_tier: billingTier, subscription_status: subscription.status,
      stripe_customer_id: subscription.customer, stripe_subscription_id: subscription.id,
      pro_period_start: period.start ? new Date(period.start * 1000).toISOString() : null,
      pro_period_end: period.end ? new Date(period.end * 1000).toISOString() : null
    };
    if (subscriptionUserId) await supabase.from("profiles").update(update).eq("id", subscriptionUserId);
    else await supabase.from("profiles").update(update).eq("stripe_subscription_id", subscription.id);
    let resolvedUserId = subscriptionUserId;
    if (!resolvedUserId) {
      const lookup = await supabase.from("profiles").select("id").eq("stripe_subscription_id", subscription.id).maybeSingle();
      resolvedUserId = lookup.data?.id;
    }
    if (resolvedUserId) {
      const snapshotPrice = subscription.items?.data?.[0]?.price;
      const snapshotRecurring = snapshotPrice?.recurring;
      const snapshotMrr = snapshotPrice?.unit_amount == null ? 0
        : snapshotRecurring?.interval === "year" ? Math.round(snapshotPrice.unit_amount / 12)
          : snapshotRecurring?.interval === "month" ? Math.round(snapshotPrice.unit_amount / Math.max(1, snapshotRecurring.interval_count || 1)) : 0;
      await tracking.record({
        name: "user_plan_snapshot", businessKey: `user_plan_snapshot:${resolvedUserId}:${event.id}`,
        userId: resolvedUserId, source: "stripe", properties: {
          plan: active ? billingTier : "free", subscription_status: subscription.status,
          currency: String(snapshotPrice?.currency || "jpy").toUpperCase(), mrr_minor: active ? snapshotMrr : 0
        }
      });
      if (event.type === "customer.subscription.deleted") {
        await tracking.record({ name: "subscription_cancelled", businessKey: `subscription_cancelled:${subscription.id}`, userId: resolvedUserId, source: "stripe", properties: { subscription_status: subscription.status } });
      }
    }
    }
    await tracking.record({ name: "stripe_webhook_processed", businessKey: `stripe_webhook_processed:${event.id}`, userId, source: "stripe", properties: { stripe_event_type: event.type } });
    return res.json({ received: true, processed: true });
  } catch (error) {
    console.error("STRIPE_WEBHOOK_PROCESSING_FAILED", event.id, event.type, String(error.message || error));
    return res.status(500).json({ error: "WEBHOOK_PROCESSING_FAILED", eventId: event.id });
  }
}
app.post("/api/v1/stripe/webhook", stripeWebhookRaw, handleStripeWebhook);
app.post("/stripe/webhook", stripeWebhookRaw, handleStripeWebhook);

async function trackingEventsBetween(startAt, endAt) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from("tracking_events")
      .select("id,event_name,user_id,anonymous_id,source,properties,occurred_at")
      .eq("environment", "production").gte("occurred_at", startAt).lt("occurred_at", endAt)
      .order("occurred_at", { ascending: true }).range(from, from + pageSize - 1);
    if (error) return { data: rows, error };
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return { data: rows, error: null };
  }
}

function analyticsPeriod(req) {
  const requestedTimeZone = String(req.query.timeZone || "Asia/Tokyo");
  const timeZone = ["Asia/Tokyo", "Asia/Taipei", "UTC"].includes(requestedTimeZone) ? requestedTimeZone : "Asia/Tokyo";
  const requestedStart = Date.parse(String(req.query.startAt || dashboardStatsStartAt));
  const requestedEnd = Date.parse(String(req.query.endAt || new Date(`${localDate}T24:00:00${offset}`).toISOString()));
  const startAt = new Date(Math.max(Date.parse(dashboardStatsStartAt), Number.isFinite(requestedStart) ? requestedStart : Date.parse(dashboardStatsStartAt))).toISOString();
  const endAt = new Date(Math.min(Date.now(), Number.isFinite(requestedEnd) ? requestedEnd : Date.now())).toISOString();
  return startAt < endAt ? { timeZone, startAt, endAt } : null;
}

async function operationalTrackingEvents(startAt, endAt) {
  const [profilesResult, eventsResult] = await Promise.all([
    supabase.from("profiles").select("id,role,is_test_account"),
    trackingEventsBetween(startAt, endAt),
  ]);
  if (profilesResult.error || eventsResult.error) return { error: profilesResult.error || eventsResult.error };
  const profiles = profilesResult.data || [];
  return { data: filterOperationalEvents(eventsResult.data || [], profiles) };
}

async function analyticsRequest(req, res, presenter) {
  const module = normalizeModule(req.query.module);
  if (!module) return res.status(400).json({ error: "INVALID_ANALYTICS_MODULE", allowedModules: ["reply", "analysis", "strategy"] });
  const period = analyticsPeriod(req);
  if (!period) return res.status(400).json({ error: "INVALID_ANALYTICS_PERIOD" });
  const events = await operationalTrackingEvents(period.startAt, period.endAt);
  if (events.error) return res.status(500).json({ error: "ANALYTICS_READ_FAILED" });
  return res.json({ module, timeZone: period.timeZone, period: { startAt: period.startAt, endAt: period.endAt }, ...presenter(events.data, module) });
}

app.get("/api/v1/admin/analytics/module", requireUser, requireAdmin, async (req, res) =>
  analyticsRequest(req, res, (events, module) => ({ overview: moduleOverview(events, module) }))
);

app.get("/api/v1/admin/analytics/funnel", requireUser, requireAdmin, async (req, res) =>
  analyticsRequest(req, res, (events, module) => ({ funnel: moduleFunnel(events, module) }))
);

app.get("/api/v1/admin/analytics/costs", requireUser, requireAdmin, async (req, res) =>
  analyticsRequest(req, res, (events, module) => ({ costs: moduleCosts(events, module) }))
);

app.get("/api/v1/admin/dashboard", requireUser, requireAdmin, async (req, res) => {
  const requestedTimeZone = String(req.query.timeZone || "Asia/Tokyo");
  const timeZone = ["Asia/Tokyo", "Asia/Taipei", "UTC"].includes(requestedTimeZone) ? requestedTimeZone : "Asia/Tokyo";
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const offset = timeZone === "UTC" ? "+00:00" : timeZone === "Asia/Taipei" ? "+08:00" : "+09:00";
  const dayStart = new Date(`${localDate}T00:00:00${offset}`).toISOString();
  const requestedStart = Date.parse(String(req.query.startAt || dayStart));
  const requestedEnd = Date.parse(String(req.query.endAt || new Date().toISOString()));
  const periodStart = new Date(Math.max(Date.parse(dashboardStatsStartAt), Number.isFinite(requestedStart) ? requestedStart : Date.parse(dayStart))).toISOString();
  const periodEnd = new Date(Number.isFinite(requestedEnd) ? requestedEnd : new Date(`${localDate}T24:00:00${offset}`).getTime()).toISOString();
  if (periodStart >= periodEnd) return res.status(400).json({ error: "INVALID_DASHBOARD_PERIOD" });
  const { data, error } = await supabase.rpc("developer_dashboard_summary", { day_start: dayStart });
  if (error) return res.status(500).json({ error: "DASHBOARD_READ_FAILED" });
  const [profilesResult, analyses30d, eventsResult, usageResult, authResult, attributionResult, anonymousTrialsResult, strategyTrialsResult] = await Promise.all([
    supabase.from("profiles").select("id,display_name,plan,billing_tier,lifetime_free_usage,pro_period_usage,subscription_status,role,is_test_account,created_at"),
    supabase.from("analyses").select("id,user_id,status").gte("created_at", periodStart).lt("created_at", periodEnd),
    trackingEventsBetween(periodStart, periodEnd),
    supabase.from("ai_usage_periods").select("user_id,used_units,budget_units,updated_at"),
    supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    supabase.from("user_ad_attributions").select("user_id,source,medium,campaign,campaign_id,ad_group,ad_group_id,ad,ad_id,creative_id,utm_content,utm_term,placement,ttclid,landing_page,captured_at"),
    supabase.from("anonymous_trials").select("device_hash,reply_used,analysis_used,started_at,expires_at,last_seen_at"),
    supabase.from("strategy_trial_usage").select("actor_key,user_id,device_hash,used,started_at,expires_at,updated_at")
  ]);
  const allProfiles = profilesResult.data || [];
  const profiles = allProfiles.filter((profile) => profile.role !== "admin" && !profile.is_test_account);
  if (eventsResult.error) return res.status(500).json({ error: "DASHBOARD_EVENTS_READ_FAILED" });
  const events = eventsResult.data || [];
  const authUsers = authResult.data?.users || [];
  const authById = new Map(authUsers.map((user) => [user.id, user]));
  const customerIds = new Set(profiles.map((profile) => profile.id));
  const attributionByUser = new Map((attributionResult.data || []).filter((item) => customerIds.has(item.user_id)).map((item) => [item.user_id, item]));
  const operationalEvents = filterOperationalEvents(events, allProfiles);
  const aiEvents = operationalEvents.filter((event) => event.event_name === "ai_usage_completed");
  const aiUsage = aiUsageSummary(operationalEvents);
  const aiCalls = aiEvents.length;
  const aiTokens = aiEvents.reduce((sum, event) => sum + Number(event.properties?.total_tokens || 0), 0);
  const aiCostMicros = aiEvents.reduce((sum, event) => sum + Number(event.properties?.cost_micros || 0), 0);
  const pricingUnconfigured = aiEvents.filter((event) => event.properties?.cost_status === "unconfigured").length;
  const funnelNames = [
    "page_viewed", "free_trial_cta_clicked", "app_session_start", "anonymous_session_created", "login_opened", "google_login_clicked", "line_login_clicked", "email_input_started", "google_login_succeeded",
    "line_login_succeeded", "email_login_succeeded", "first_screenshot_uploaded",
    "first_ai_usage_completed", "upgrade_clicked", "stripe_checkout_opened", "subscription_started"
  ];
  const funnelActors = new Map(funnelNames.map((name) => [name, new Set()]));
  const linkedUserByAnonymous = new Map(operationalEvents
    .filter((event) => event.anonymous_id && event.user_id && customerIds.has(event.user_id))
    .map((event) => [event.anonymous_id, event.user_id]));
  for (const event of operationalEvents) {
    const actors = funnelActors.get(event.event_name);
    if (!actors) continue;
    const actor = event.user_id || linkedUserByAnonymous.get(event.anonymous_id) || event.anonymous_id;
    if (actor) actors.add(actor);
  }
  // A product-activation funnel must not count direct visits to the login page.
  // Only retain login opens that happened after the same actor uploaded a chat
  // or completed an AI feature during the selected period.
  const allLoginActors = new Set(funnelActors.get("login_opened"));
  const activationAt = new Map();
  const qualifiedLoginActors = new Set();
  for (const event of [...operationalEvents].sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)))) {
    const actor = event.user_id || linkedUserByAnonymous.get(event.anonymous_id) || event.anonymous_id;
    if (!actor) continue;
    if (["first_screenshot_uploaded", "first_ai_usage_completed"].includes(event.event_name) && !activationAt.has(actor)) activationAt.set(actor, event.occurred_at);
    if (event.event_name === "login_opened" && activationAt.has(actor)) qualifiedLoginActors.add(actor);
  }
  funnelActors.set("login_opened", qualifiedLoginActors);
  funnelActors.set("direct_login_opened", new Set([...allLoginActors].filter((actor) => !qualifiedLoginActors.has(actor))));
  // OAuth completion tracking is best effort in the browser. Supabase's
  // authoritative successful sign-in record fills any event lost on redirect.
  for (const auth of authUsers) {
    if (!customerIds.has(auth.id) || !auth.last_sign_in_at || auth.last_sign_in_at < periodStart || auth.last_sign_in_at >= periodEnd) continue;
    const provider = auth.app_metadata?.provider || auth.identities?.[0]?.provider || "email";
    const name = provider === "custom:line-oauth" || provider === "line" ? "line_login_succeeded"
      : provider === "google" ? "google_login_succeeded" : provider === "email" ? "email_login_succeeded" : null;
    if (name) funnelActors.get(name).add(auth.id);
  }
  const funnel = Object.fromEntries([...funnelActors].map(([name, actors]) => [name, actors.size]));
  const moduleCostSummaries = Object.fromEntries(["reply", "analysis", "strategy"].map((module) =>
    [module, moduleCosts(operationalEvents, module)]
  ));
  const moduleSummaries = Object.fromEntries(["reply", "analysis", "strategy"].map((module) => {
    const scoped = operationalEvents.filter((event) => eventModule(event) === module);
    const completed = scoped.filter((event) => event.event_name === "ai_usage_completed");
    const failed = scoped.filter((event) => event.event_name === "ai_usage_failed");
    const usage = aiUsageSummary(scoped);
    return [module, { actors: usage.users, anonymousActors: usage.anonymousUsers, completed: completed.length, failed: failed.length,
      successRate: completed.length + failed.length ? Number((completed.length / (completed.length + failed.length) * 100).toFixed(1)) : null,
      costMicros: moduleCostSummaries[module].costMicros }];
  }));
  const anonymousTrials = (anonymousTrialsResult.data || []).filter((trial) => trial.started_at < periodEnd && trial.last_seen_at >= periodStart);
  const strategyTrials = (strategyTrialsResult.data || []).filter((trial) => trial.started_at && trial.started_at < periodEnd && trial.updated_at >= periodStart);
  const anonymousActors = new Set(operationalEvents.filter((event) => !event.user_id).map((event) => event.anonymous_id).filter(Boolean));
  const linkedAnonymousActors = new Set(operationalEvents.filter((event) => event.anonymous_id && event.user_id && customerIds.has(event.user_id)).map((event) => event.anonymous_id));
  const featureEvents = { safetyViews: 0, safetyStarts: 0, recordsStarted: 0, recordsSaved: 0, timelinesViewed: 0 };
  for (const event of operationalEvents) {
    if (event.event_name === "dating_safety_entry_viewed") featureEvents.safetyViews += 1;
    if (event.event_name === "dating_safety_card_clicked") featureEvents.safetyStarts += 1;
    if (event.event_name === "manual_record_start") featureEvents.recordsStarted += 1;
    if (event.event_name === "manual_record_saved") featureEvents.recordsSaved += 1;
    if (event.event_name === "timeline_view") featureEvents.timelinesViewed += 1;
  }
  const errorEvents = events.filter((event) => ["api_request_failed", "ai_usage_failed", "stripe_webhook_failed", "payment_failed", "google_login_failed", "line_login_failed", "email_otp_failed"].includes(event.event_name)).slice(-100).reverse();
  const revenue = (start) => events.filter((event) => ["subscription_started", "subscription_renewed"].includes(event.event_name) && event.occurred_at >= start)
    .reduce((sum, event) => sum + Number(event.properties?.revenue_minor || 0), 0);
  const refunds = events.filter((event) => event.event_name === "payment_refunded");
  const supportedCurrencies = ["JPY", "USD", "TWD", "HKD"];
  const latestPlanByUser = new Map();
  for (const event of events.filter((item) => item.event_name === "user_plan_snapshot" && item.user_id)) latestPlanByUser.set(event.user_id, event);
  const paymentsByCurrency = supportedCurrencies.map((currency) => {
    const paid = events.filter((event) => ["subscription_started", "subscription_renewed"].includes(event.event_name)
      && event.occurred_at >= periodStart && String(event.properties?.currency || "JPY").toUpperCase() === currency);
    const refunded = refunds.filter((event) => event.occurred_at >= periodStart
      && String(event.properties?.currency || "JPY").toUpperCase() === currency);
    const activePlans = [...latestPlanByUser.values()].filter((event) => ["active", "trialing"].includes(event.properties?.subscription_status)
      && String(event.properties?.currency || "JPY").toUpperCase() === currency);
    return { currency, revenueMinor: paid.reduce((sum, event) => sum + Number(event.properties?.revenue_minor || 0), 0),
      refundMinor: refunded.reduce((sum, event) => sum + Number(event.properties?.revenue_minor || 0), 0),
      mrrMinor: activePlans.reduce((sum, event) => sum + Number(event.properties?.mrr_minor || 0), 0) };
  });
  const usageById = new Map((usageResult.data || []).map((usage) => [usage.user_id, usage]));
  const users = profiles.map((profile) => {
    const auth = authById.get(profile.id);
    const provider = auth?.app_metadata?.provider || auth?.identities?.[0]?.provider || "email";
    const totalCostMicros = events.filter((event) => event.user_id === profile.id && event.event_name === "ai_usage_completed")
      .reduce((sum, event) => sum + Number(event.properties?.cost_micros || 0), 0);
    const fair = usageById.get(profile.id);
    return { id: profile.id, email: auth?.email || "", displayName: profile.display_name, createdAt: profile.created_at,
      provider, plan: profile.billing_tier || profile.plan, lifetimeUsage: profile.lifetime_free_usage, lastSignInAt: auth?.last_sign_in_at || null,
      bannedUntil: auth?.banned_until || null, totalCostMicros, freeLimitReached: profile.plan === "free" && profile.lifetime_free_usage >= 5,
      freeRestricted: profile.plan === "free" && profile.lifetime_free_usage >= 5,
      fairUseTriggered: Boolean(fair && fair.used_units >= fair.budget_units), attribution: attributionByUser.get(profile.id) || null };
  });
  const periodProfiles = profiles.filter((profile) => profile.created_at >= periodStart && profile.created_at < periodEnd);
  const total = periodProfiles.length;
  const pro = periodProfiles.filter((profile) => profile.plan === "pro" && ["active", "trialing"].includes(profile.subscription_status)).length;
  const customerAnalyses = (analyses30d.data || []).filter((analysis) => customerIds.has(analysis.user_id));
  const analysisCount = customerAnalyses.length;
  const failedAnalysisCount = customerAnalyses.filter((analysis) => analysis.status === "failed").length;
  const creativeGroups = new Map();
  const groupForUser = (userId) => {
    const item = attributionByUser.get(userId);
    if (!item) return null;
    const key = item.creative_id || item.utm_content || item.ad_id || item.campaign_id || item.campaign || "unknown";
    if (!creativeGroups.has(key)) creativeGroups.set(key, { key, ...item, registrations: new Set(), uploads: new Set(), analyses: new Set(), payments: new Set() });
    return creativeGroups.get(key);
  };
  for (const profile of periodProfiles) groupForUser(profile.id)?.registrations.add(profile.id);
  for (const event of operationalEvents) {
    const resolvedUserId = event.user_id || linkedUserByAnonymous.get(event.anonymous_id);
    if (!resolvedUserId) continue;
    const group = groupForUser(resolvedUserId);
    if (!group) continue;
    if (event.event_name === "first_screenshot_uploaded") group.uploads.add(resolvedUserId);
    if (event.event_name === "first_ai_usage_completed") group.analyses.add(resolvedUserId);
    if (event.event_name === "subscription_started") group.payments.add(resolvedUserId);
  }
  const creativeFunnels = [...creativeGroups.values()].map((group) => ({
    key: group.key, source: group.source || null, medium: group.medium || null, campaign: group.campaign || null,
    campaignId: group.campaign_id || null, adGroup: group.ad_group || null, adGroupId: group.ad_group_id || null,
    ad: group.ad || null, adId: group.ad_id || null, creativeId: group.creative_id || null,
    utmContent: group.utm_content || null, placement: group.placement || null,
    registrations: group.registrations.size, uploads: group.uploads.size,
    analyses: group.analyses.size, payments: group.payments.size
  })).sort((left, right) => right.registrations - left.registrations);
  res.json({ ...data, funnel, timeZone, period: { startAt: periodStart, endAt: periodEnd },
    core: { registeredUsers: total, proUsers: pro, analyses30d: analysisCount,
      proConversionRate: total ? Number((pro / total * 100).toFixed(1)) : 0,
      aiSuccessRate: analysisCount ? Number(((analysisCount - failedAnalysisCount) / analysisCount * 100).toFixed(1)) : 100 },
    ai: { ...data.ai, callsToday: aiCalls, tokensToday: aiTokens, costMicrosToday: aiCostMicros,
      callsTotal: aiCalls, costMicrosTotal: aiCostMicros, pricingUnconfigured,
      usersWithAi: aiUsage.users, anonymousUsersWithAi: aiUsage.anonymousUsers,
      firstAiUsers: aiUsage.firstAiUsers, unattributedCalls: aiUsage.unattributedCalls,
      averageAnalysisCostMicros: aiCalls ? Math.round(aiCostMicros / aiCalls) : 0,
      replyCostMicros: moduleCostSummaries.reply.costMicros,
      analysisCostMicros: moduleCostSummaries.analysis.costMicros,
      strategyCostMicros: moduleCostSummaries.strategy.costMicros },
    payments: { todayRevenueMinor: revenue(periodStart), monthRevenueMinor: revenue(periodStart),
      newSubscriptions: operationalEvents.filter((event) => event.event_name === "subscription_started").length,
      cancellations: operationalEvents.filter((event) => event.event_name === "subscription_cancelled").length, refunds: refunds.length,
      refundMinor: refunds.reduce((sum, event) => sum + Number(event.properties?.revenue_minor || 0), 0),
      mrrMinor: revenue(periodStart), currency: data.subscriptions.currency, byCurrency: paymentsByCurrency },
    errors: errorEvents.map((event) => ({ id: event.id, type: event.event_name, source: event.source, code: event.properties?.error_code || null,
      message: event.properties?.failure_message || null, statusCode: event.properties?.status_code || null, occurredAt: event.occurred_at })),
    product: {
      anonymous: { actors: anonymousActors.size, linkedToUsers: linkedAnonymousActors.size,
        loginConversionRate: anonymousActors.size ? Number((linkedAnonymousActors.size / anonymousActors.size * 100).toFixed(1)) : 0,
        trialDevices: anonymousTrials.length, replyUses: anonymousTrials.reduce((sum, item) => sum + Number(item.reply_used || 0), 0),
        analysisUses: anonymousTrials.reduce((sum, item) => sum + Number(item.analysis_used || 0), 0),
        expiredTrials: anonymousTrials.filter((item) => new Date(item.expires_at).getTime() <= Date.now()).length,
        strategyTrials: strategyTrials.length, strategyUses: strategyTrials.filter((item) => item.used).length },
      modules: moduleSummaries, features: featureEvents,
    },
    users, creativeFunnels, collectionNote: `统计范围：${periodStart} 至 ${periodEnd}；AI 调用按完成事件计数，使用人数按登录用户或匿名设备统一去重；无法绑定两者的完成事件单列为未归属调用；管理员与测试账号已排除。` });
});

app.get("/api/v1/admin/summary", requireUser, requireAdmin, async (_req, res) => {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const [profilesResult, analysesResult] = await Promise.all([
    supabase.from("profiles").select("id,plan,role,is_test_account"),
    supabase.from("analyses").select("id,user_id,status").gte("created_at", since)
  ]);
  const customers = (profilesResult.data || []).filter((profile) => profile.role !== "admin" && !profile.is_test_account);
  const customerIds = new Set(customers.map((profile) => profile.id));
  const analyses = (analysesResult.data || []).filter((analysis) => customerIds.has(analysis.user_id));
  const proUsers = customers.filter((profile) => profile.plan === "pro").length;
  const analysisCount = analyses.length;
  const failedCount = analyses.filter((analysis) => analysis.status === "failed").length;
  res.json({
    users: customers.length, proUsers, analyses30d: analysisCount,
    conversionRate: customers.length ? Number(((proUsers / customers.length) * 100).toFixed(1)) : 0,
    successRate: analysisCount ? Number((((analysisCount - failedCount) / analysisCount) * 100).toFixed(1)) : 100
  });
});

app.delete("/api/v1/me", requireUser, async (req, res) => {
  const { error } = await supabase.auth.admin.deleteUser(req.user.id);
  if (error) return res.status(500).json({ error: "ACCOUNT_DELETE_FAILED" });
  res.sendStatus(204);
});

app.get("/api/v1/relationships", requireUser, async (req, res) => {
  const { data, error } = await supabase.from("relationships").select("*")
    .eq("user_id", req.user.id)
    .order("status", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: "RELATIONSHIPS_READ_FAILED" });
  res.json({ relationships: data });
});

app.post("/api/v1/relationships", requireUser, express.json(), async (req, res) => {
  if (req.body?.archiveCurrent !== true) {
    return res.status(400).json({ error: "ARCHIVE_CONFIRMATION_REQUIRED" });
  }
  const title = req.body?.title == null ? null : String(req.body.title).trim();
  if (title && title.length > 120) return res.status(400).json({ error: "INVALID_RELATIONSHIP_TITLE" });
  const startedOn = req.body?.startedOn || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startedOn)) return res.status(400).json({ error: "INVALID_START_DATE" });

  const { data, error } = await supabase.rpc("switch_relationship", {
    target_user_id: req.user.id,
    archive_current: true,
    new_title: title,
    new_started_on: startedOn
  });
  if (error) return res.status(500).json({ error: "RELATIONSHIP_SWITCH_FAILED" });
  res.status(201).json({ relationship: data });
});

app.get("/api/v1/relationships/:relationshipId/events", requireUser, async (req, res) => {
  const { data: relationship, error: relationshipError } = await findOwnedRelationship(req.user.id, req.params.relationshipId);
  if (relationshipError) return res.status(500).json({ error: "RELATIONSHIP_READ_FAILED" });
  if (!relationship) return res.status(404).json({ error: "RELATIONSHIP_NOT_FOUND" });

  const { data, error } = await supabase.from("timeline_events").select("*")
    .eq("relationship_id", relationship.id)
    .eq("user_id", req.user.id)
    .is("deleted_at", null)
    .order("event_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return res.status(500).json({ error: "TIMELINE_READ_FAILED" });
  res.json({ events: data });
});

app.post("/api/v1/relationships/:relationshipId/events", requireUser, express.json(), async (req, res) => {
  const { data: relationship, error: relationshipError } = await findOwnedRelationship(req.user.id, req.params.relationshipId);
  if (relationshipError) return res.status(500).json({ error: "RELATIONSHIP_READ_FAILED" });
  if (!relationship) return res.status(404).json({ error: "RELATIONSHIP_NOT_FOUND" });
  if (relationship.status !== "active") return res.status(409).json({ error: "RELATIONSHIP_ARCHIVED" });

  const cleaned = cleanTimelineInput(req.body);
  if (cleaned.error) return res.status(400).json({ error: cleaned.error });
  const { data, error } = await supabase.from("timeline_events").insert({
    relationship_id: relationship.id,
    user_id: req.user.id,
    source: "user",
    ...cleaned.value
  }).select("*").single();
  if (error) return res.status(500).json({ error: "TIMELINE_EVENT_CREATE_FAILED" });
  res.status(201).json({ event: data });
});

app.patch("/api/v1/timeline-events/:id", requireUser, express.json(), async (req, res) => {
  const cleaned = cleanTimelineInput(req.body, true);
  if (cleaned.error) return res.status(400).json({ error: cleaned.error });
  if (!Object.keys(cleaned.value).length) return res.status(400).json({ error: "NO_EVENT_CHANGES" });

  const { data, error } = await supabase.from("timeline_events").update({
    ...cleaned.value,
    user_edited: true
  }).eq("id", req.params.id).eq("user_id", req.user.id).is("deleted_at", null)
    .select("*").maybeSingle();
  if (error) return res.status(500).json({ error: "TIMELINE_EVENT_UPDATE_FAILED" });
  if (!data) return res.status(404).json({ error: "TIMELINE_EVENT_NOT_FOUND" });
  res.json({ event: data });
});

app.delete("/api/v1/timeline-events/:id", requireUser, async (req, res) => {
  const { data, error } = await supabase.from("timeline_events")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", req.params.id).eq("user_id", req.user.id).is("deleted_at", null)
    .select("id").maybeSingle();
  if (error) return res.status(500).json({ error: "TIMELINE_EVENT_DELETE_FAILED" });
  if (!data) return res.status(404).json({ error: "TIMELINE_EVENT_NOT_FOUND" });
  res.sendStatus(204);
});

app.get("/api/v1/relationships/:relationshipId/reports", requireUser, async (req, res) => {
  const { data: relationship, error: relationshipError } = await findOwnedRelationship(req.user.id, req.params.relationshipId);
  if (relationshipError) return res.status(500).json({ error: "RELATIONSHIP_READ_FAILED" });
  if (!relationship) return res.status(404).json({ error: "RELATIONSHIP_NOT_FOUND" });
  const { data, error } = await supabase.from("relationship_reports").select("*")
    .eq("relationship_id", relationship.id).eq("user_id", req.user.id)
    .order("period_start", { ascending: false });
  if (error) return res.status(500).json({ error: "REPORTS_READ_FAILED" });
  res.json({ reports: data });
});

app.post("/api/v1/relationships/:relationshipId/reports/generate", requireUser, express.json(), async (req, res) => {
  const { data: relationship, error: relationshipError } = await findOwnedRelationship(req.user.id, req.params.relationshipId);
  if (relationshipError) return res.status(500).json({ error: "RELATIONSHIP_READ_FAILED" });
  if (!relationship) return res.status(404).json({ error: "RELATIONSHIP_NOT_FOUND" });

  const periodType = String(req.body?.periodType || "");
  const locale = ["ja", "zh-TW", "en"].includes(req.body?.locale) ? req.body.locale : "ja";
  let bounds;
  try { bounds = periodBounds(periodType, req.body?.anchorDate); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  const startTime = `${bounds.start}T00:00:00.000Z`;
  const endTime = `${bounds.end}T23:59:59.999Z`;
  const [analysisQuery, eventQuery] = await Promise.all([
    supabase.from("analyses").select("created_at,completed_at,result")
      .eq("relationship_id", relationship.id).eq("user_id", req.user.id)
      .eq("mode", "analysis").eq("status", "completed")
      .gte("created_at", startTime).lte("created_at", endTime)
      .order("created_at", { ascending: true }),
    supabase.from("timeline_events").select("event_date,title,note,source")
      .eq("relationship_id", relationship.id).eq("user_id", req.user.id)
      .is("deleted_at", null).gte("event_date", bounds.start).lte("event_date", bounds.end)
      .order("event_date", { ascending: true }),
  ]);
  if (analysisQuery.error || eventQuery.error) return res.status(500).json({ error: "REPORT_SOURCE_READ_FAILED" });
  const sourceCount = (analysisQuery.data?.length || 0) + (eventQuery.data?.length || 0);
  if (!sourceCount) {
    return res.status(422).json({ error: "REPORT_DATA_INSUFFICIENT" });
  }
  if (sourceCount < 2) {
    return res.status(422).json({ error: "REPORT_DATA_TOO_SPARSE" });
  }

  try {
    const usage = await usageService.check(req.user.id, "relationshipLog");
    if (!usage.allowed) return res.status(429).json({ error: "FAIR_USE_LIMIT_REACHED" });
    const reportCallId = crypto.randomUUID();
    const generated = await generateRelationshipReport({
      periodType, locale, periodStart: bounds.start, periodEnd: bounds.end,
      analyses: analysisQuery.data || [], events: eventQuery.data || [],
    });
    await tracking.record({
      name: "ai_usage_completed",
      businessKey: `ai_usage_completed:relationship_report:${reportCallId}`,
      userId: req.user.id, source: "ai", properties: generated.usage
    });
    const { data, error } = await supabase.from("relationship_reports").upsert({
      relationship_id: relationship.id,
      user_id: req.user.id,
      period_type: periodType,
      period_start: bounds.start,
      period_end: bounds.end,
      locale,
      content: generated.content,
      model_name: generated.model,
      generated_at: new Date().toISOString(),
    }, { onConflict: "relationship_id,period_type,period_start,locale" }).select("*").single();
    if (error) return res.status(500).json({ error: "REPORT_STORE_FAILED" });
    await usageService.recordSuccess(usage);
    res.status(201).json({ report: data });
  } catch (error) {
    console.error("REPORT GENERATION FAILED", String(error.message || error));
    const status = Number(error?.response?.status || 0);
    const code = String(error?.code || "");
    const message = String(error?.message || "");
    if (message === "OPENAI_NOT_CONFIGURED") return res.status(503).json({ error: "REPORT_AI_NOT_CONFIGURED" });
    if (status === 401 || status === 403) return res.status(503).json({ error: "REPORT_AI_AUTH_FAILED" });
    if (status === 429) return res.status(503).json({ error: "REPORT_AI_RATE_LIMITED" });
    if (message === "AI_INVALID_JSON" || message === "AI_INVALID_RESULT") return res.status(502).json({ error: "REPORT_AI_INVALID_RESPONSE" });
    if (code === "ECONNABORTED" || code === "ETIMEDOUT") return res.status(504).json({ error: "REPORT_AI_TIMEOUT" });
    if (["ENOTFOUND", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN"].includes(code)) return res.status(503).json({ error: "REPORT_AI_NETWORK_FAILED" });
    res.status(500).json({ error: "REPORT_GENERATION_FAILED" });
  }
});

app.get("/api/v1/anonymous/trial", async (req, res) => {
  try {
    const identity = anonymousIdentity(req);
    if (!identity) return res.status(400).json({ error: "ANONYMOUS_ID_REQUIRED" });
    const { data, error } = await supabase.from("anonymous_trials")
      .select("reply_used,analysis_used,started_at,expires_at")
      .eq("device_hash", identity.deviceHash).maybeSingle();
    if (error) return res.status(500).json({ error: "TRIAL_STATUS_FAILED" });
    res.json({
      trial: data ? {
        replyUsed: Number(data.reply_used || 0), replyLimit: 5,
        analysisUsed: Number(data.analysis_used || 0), analysisLimit: 3,
        startedAt: data.started_at, expiresAt: data.expires_at,
        expired: new Date(data.expires_at).getTime() <= Date.now(),
      } : { replyUsed: 0, replyLimit: 5, analysisUsed: 0, analysisLimit: 3, startedAt: null, expiresAt: null, expired: false }
    });
  } catch (error) {
    console.error("ANONYMOUS TRIAL STATUS FAILED", String(error.message || error));
    res.status(500).json({ error: "TRIAL_STATUS_FAILED" });
  }
});

app.post(
  "/api/v1/anonymous/analyses",
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "10mb" }),
  async (req, res) => {
    const identity = anonymousIdentity(req);
    if (!identity) return res.status(400).json({ error: "ANONYMOUS_ID_REQUIRED" });
    const mode = req.headers["x-analysis-mode"];
    const requestedLocale = String(req.headers["x-locale"] || "ja");
    const locale = ["ja", "zh-TW", "en"].includes(requestedLocale) ? requestedLocale : "ja";
    const mimeType = String(req.headers["content-type"] || "").split(";")[0];
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "IMAGE_REQUIRED" });
    if (!isSupportedImage(req.body, mimeType)) return res.status(415).json({ error: "INVALID_IMAGE_FILE" });
    if (!["reply", "analysis"].includes(mode)) return res.status(400).json({ error: "INVALID_MODE" });
    const replySettings = cleanReplySettings(req);
    if (mode === "reply" && replySettings.error) return res.status(400).json({ error: replySettings.error });

    const { data: rows, error: reserveError } = await supabase.rpc("reserve_anonymous_analysis_credit", {
      target_device_hash: identity.deviceHash,
      target_risk_hash: identity.riskHash,
      target_network_hash: identity.networkHash,
      target_mode: mode,
    });
    if (reserveError) {
      console.error("ANONYMOUS CREDIT CHECK FAILED", reserveError.message);
      return res.status(500).json({ error: "CREDIT_CHECK_FAILED" });
    }
    const credit = rows?.[0];
    if (!credit?.allowed) {
      return res.status(402).json({ error: credit?.reason || "TRIAL_LIMIT_REACHED", trial: credit || null });
    }

    const requestId = crypto.randomUUID();
    try {
      const output = await analyzeForWeb({
        imageBuffer: req.body, mimeType, mode, locale,
        context: replySettings.value,
      });
      await tracking.record({
        name: "ai_usage_completed", businessKey: `anonymous_ai_usage_completed:${requestId}`,
        anonymousId: identity.deviceHash, source: "ai", properties: { ...output.usage, module: mode, mode, anonymous: true }
      });
      for (const [index, usage] of (output.auxiliaryUsages || []).entries()) {
        await tracking.record({
          name: "ai_usage_completed", businessKey: `anonymous_ai_usage_completed:${requestId}:aux:${index}`,
          anonymousId: identity.deviceHash, source: "ai", properties: { ...usage, module: mode, mode, anonymous: true }
        });
      }
      res.status(201).json({
        analysis: { id: requestId, mode, status: "completed", result: output.result, completed_at: new Date().toISOString() },
        trial: {
          replyUsed: Number(credit.reply_used), replyLimit: Number(credit.reply_limit),
          analysisUsed: Number(credit.analysis_used), analysisLimit: Number(credit.analysis_limit),
          expiresAt: credit.expires_at,
        }
      });
    } catch (error) {
      try {
        await supabase.rpc("refund_anonymous_analysis_credit", {
          target_device_hash: identity.deviceHash,
          target_risk_hash: identity.riskHash,
          target_mode: mode,
        });
      } catch {}
      await tracking.record({
        name: "ai_usage_failed", businessKey: `anonymous_ai_usage_failed:${requestId}`,
        anonymousId: identity.deviceHash, source: "ai", properties: { module: mode, mode, anonymous: true, error_code: String(error.message || "AI_FAILED").slice(0, 80) }
      });
      console.error("ANONYMOUS ANALYSIS FAILED", requestId, mode, String(error.message || error));
      res.status(502).json({ error: "ANALYSIS_FAILED" });
    }
  }
);

app.post("/api/v1/anonymous/conversation-replies", express.json({ limit: "128kb" }), async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages
    .filter((item) => ["self", "partner"].includes(item?.sender) && String(item?.text || "").trim())
    .slice(-80)
    .map((item) => ({
      sender: item.sender,
      text: String(item.text).trim().slice(0, 1500),
      timestamp: item.timestamp == null ? null : String(item.timestamp).trim().slice(0, 80) || null,
    })) : [];
  if (!messages.length) return res.status(400).json({ error: "CONVERSATION_REQUIRED" });
  const requestedLocale = String(req.headers["x-locale"] || "ja");
  const locale = ["ja", "zh-TW", "en"].includes(requestedLocale) ? requestedLocale : "ja";
  const replySettings = cleanReplySettings(req);
  if (replySettings.error) return res.status(400).json({ error: replySettings.error });
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const authenticatedUser = token ? (await supabase.auth.getUser(token)).data?.user : null;
  const { data: profile } = authenticatedUser
    ? await supabase.from("profiles").select("plan,billing_tier,role,is_test_account").eq("id", authenticatedUser.id).maybeSingle()
    : { data: null };
  const privileged = profile?.role === "admin" || Boolean(profile?.is_test_account);
  let paidUsage = null;
  let identity = null;
  let credit = null;
  if (!privileged && profile?.plan === "pro") {
    try {
      paidUsage = await usageService.check(authenticatedUser.id, "reply");
    } catch (error) {
      console.error("CONVERSATION REPLY USAGE CHECK FAILED", String(error.message || error));
      return res.status(500).json({ error: "CREDIT_CHECK_FAILED" });
    }
    if (!paidUsage.allowed) return res.status(429).json({ error: "FAIR_USE_LIMIT_REACHED" });
  } else if (!privileged) {
    identity = anonymousIdentity(req);
    if (!identity) return res.status(400).json({ error: "ANONYMOUS_ID_REQUIRED" });
    const { data: rows, error: reserveError } = await supabase.rpc("reserve_anonymous_analysis_credit", {
      target_device_hash: identity.deviceHash, target_risk_hash: identity.riskHash,
      target_network_hash: identity.networkHash, target_mode: "reply",
    });
    if (reserveError) return res.status(500).json({ error: "CREDIT_CHECK_FAILED" });
    credit = rows?.[0];
    if (!credit?.allowed) {
      await tracking.record({
        name: "reply_paywall_triggered",
        businessKey: `reply_paywall:${authenticatedUser?.id || identity.deviceHash}:${new Date().toISOString().slice(0, 10)}`,
        userId: authenticatedUser?.id || null,
        anonymousId: identity.deviceHash,
        source: "api",
        properties: { module: "reply", error_code: credit?.reason || "TRIAL_LIMIT_REACHED" },
      }).catch(() => null);
      return res.status(402).json({ error: credit?.reason || "TRIAL_LIMIT_REACHED", trial: credit || null });
    }
  }
  const requestId = crypto.randomUUID();
  try {
    const output = await analyzeConversationForWeb({ messages, partnerName: String(req.body?.partnerName || "").slice(0, 80), locale, context: replySettings.value });
    if (paidUsage) await usageService.recordSuccess(paidUsage);
    await tracking.record({ name: "ai_usage_completed", businessKey: `anonymous_ai_usage_completed:${requestId}`, userId: authenticatedUser?.id || null, anonymousId: identity?.deviceHash || null, source: "ai", properties: { ...output.usage, module: "reply", mode: "reply", anonymous: !authenticatedUser } });
    return res.status(201).json({
      analysis: { id: requestId, mode: "reply", status: "completed", result: output.result, completed_at: new Date().toISOString() },
      trial: credit
        ? { replyUsed: Number(credit.reply_used), replyLimit: Number(credit.reply_limit), analysisUsed: Number(credit.analysis_used), analysisLimit: Number(credit.analysis_limit), expiresAt: credit.expires_at }
        : { replyUsed: 0, replyLimit: 999999, analysisUsed: 0, analysisLimit: 999999, expiresAt: null },
    });
  } catch (error) {
    if (identity) {
      try { await supabase.rpc("refund_anonymous_analysis_credit", { target_device_hash: identity.deviceHash, target_risk_hash: identity.riskHash, target_mode: "reply" }); } catch {}
    }
    await tracking.record({ name: "ai_usage_failed", businessKey: `reply_ai_usage_failed:${requestId}`, userId: authenticatedUser?.id || null, anonymousId: identity?.deviceHash || null, source: "ai", properties: { module: "reply", mode: "reply", error_code: String(error.message || "AI_FAILED").slice(0, 80) } }).catch(() => null);
    console.error("ANONYMOUS CONVERSATION REPLY FAILED", requestId, String(error.message || error));
    return res.status(502).json({ error: "ANALYSIS_FAILED" });
  }
});

app.post("/api/v1/anonymous/conversation-analyses",express.json({limit:"192kb"}),async(req,res)=>{
 const messages=Array.isArray(req.body?.messages)?req.body.messages.filter(item=>["self","partner"].includes(item?.sender)&&String(item?.text||"").trim()).slice(-120).map(item=>({sender:item.sender,text:String(item.text).trim().slice(0,1500),timestamp:item.timestamp==null?null:String(item.timestamp).trim().slice(0,80)||null})):[];
 if(!messages.length)return res.status(400).json({error:"CONVERSATION_REQUIRED"});
 const topicId=String(req.body?.topicId||"").trim(),topic=getAnalysisTopic(topicId);
 if(!topic)return res.status(400).json({error:"INVALID_ANALYSIS_TOPIC"});
 const requestedLocale=String(req.headers["x-locale"]||"ja"),locale=["ja","zh-TW","en"].includes(requestedLocale)?requestedLocale:"ja";
 const token=String(req.headers.authorization||"").replace(/^Bearer\s+/i,""),authenticatedUser=token?(await supabase.auth.getUser(token)).data?.user:null;
 const{data:profile}=authenticatedUser?await supabase.from("profiles").select("plan,billing_tier,role,is_test_account").eq("id",authenticatedUser.id).maybeSingle():{data:null};
 const privileged=profile?.role==="admin"||Boolean(profile?.is_test_account);let paidUsage=null,identity=null,credit=null;
 if(!privileged&&profile?.plan==="pro"){
  try{paidUsage=await usageService.check(authenticatedUser.id,"analysis")}catch(error){console.error("TOPIC ANALYSIS USAGE CHECK FAILED",String(error.message||error));return res.status(500).json({error:"CREDIT_CHECK_FAILED"})}
  if(!paidUsage.allowed)return res.status(429).json({error:"FAIR_USE_LIMIT_REACHED"});
 }else if(!privileged){identity=anonymousIdentity(req);if(!identity)return res.status(400).json({error:"ANONYMOUS_ID_REQUIRED"});const{data:rows,error:reserveError}=await supabase.rpc("reserve_anonymous_analysis_credit",{target_device_hash:identity.deviceHash,target_risk_hash:identity.riskHash,target_network_hash:identity.networkHash,target_mode:"analysis"});if(reserveError)return res.status(500).json({error:"CREDIT_CHECK_FAILED"});credit=rows?.[0];if(!credit?.allowed)return res.status(402).json({error:credit?.reason||"TRIAL_LIMIT_REACHED",trial:credit||null})}
 const requestId=crypto.randomUUID();
 try{
  const output=await analyzeConversationTopicForWeb({messages,partnerName:String(req.body?.partnerName||"").slice(0,80),locale,context:{topicId:topic.id,topicTitle:topic.title,question:topic.question,evidenceInstruction:topic.evidenceInstruction,requiredModules:topic.requiredModules,optionalModules:topic.optionalModules,readinessStatus:req.body?.readinessStatus==="partial"?"partial":"sufficient"}});
  if(paidUsage)await usageService.recordSuccess(paidUsage);
  await tracking.record({name:"ai_usage_completed",businessKey:`topic_ai_usage_completed:${requestId}`,userId:authenticatedUser?.id||null,anonymousId:identity?.deviceHash||null,source:"ai",properties:{...output.usage,module:"analysis",mode:"analysis",topic_id:topicId,anonymous:!authenticatedUser}});
  let storedAnalysisId=requestId;
  if(authenticatedUser){const relationship=await findActiveRelationship(authenticatedUser.id).then(result=>result.data);const{data:stored,error:storeError}=await supabase.from("analyses").insert({user_id:authenticatedUser.id,relationship_id:relationship?.id||null,mode:"analysis",status:"completed",title:String(topic.title||"チャット分析").slice(0,100),result:output.result,completed_at:new Date().toISOString(),input_metadata:{source:"parsed_conversation",topic_id:topicId,message_count:messages.length}}).select("id").single();if(storeError)throw new Error("ANALYSIS_SAVE_FAILED");storedAnalysisId=stored.id}
  return res.status(201).json({analysis:{id:storedAnalysisId,mode:"analysis",status:"completed",result:output.result,completed_at:new Date().toISOString()},trial:credit?{replyUsed:Number(credit.reply_used),replyLimit:Number(credit.reply_limit),analysisUsed:Number(credit.analysis_used),analysisLimit:Number(credit.analysis_limit),expiresAt:credit.expires_at}:null});
 }catch(error){if(identity)try{await supabase.rpc("refund_anonymous_analysis_credit",{target_device_hash:identity.deviceHash,target_risk_hash:identity.riskHash,target_mode:"analysis"})}catch{}console.error("TOPIC ANALYSIS FAILED",requestId,String(error.message||error));return res.status(502).json({error:"ANALYSIS_FAILED"})}
});

app.post("/api/v1/anonymous/strategies", express.json({ limit: "128kb" }), async (req, res) => {
  const requestedLocale = String(req.headers["x-locale"] || "ja");
  const locale = ["ja", "zh-TW", "en"].includes(requestedLocale) ? requestedLocale : "ja";
  const cleaned = cleanStrategyInput(req.body);
  if (cleaned.error) return res.status(400).json({ error: cleaned.error });
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const authenticatedUser = token ? (await supabase.auth.getUser(token)).data?.user : null;
  const { data: profile } = authenticatedUser
    ? await supabase.from("profiles").select("plan,billing_tier,role,is_test_account").eq("id", authenticatedUser.id).maybeSingle()
    : { data: null };
  const privileged = profile?.role === "admin" || Boolean(profile?.is_test_account);
  let paidFeature = null, identity = null, credit = null;
  if (!privileged && profile?.plan === "pro") {
    try { paidFeature = await reservePaidFeature(authenticatedUser.id, profile.billing_tier === "lite" ? "lite" : "premium", "strategy"); }
    catch (error) { console.error("STRATEGY USAGE CHECK FAILED", String(error.message || error)); return res.status(500).json({ error: "CREDIT_CHECK_FAILED" }); }
    if (!paidFeature.allowed) {
      await tracking.record({ name: "strategy_paywall_triggered", businessKey: `strategy_paywall:${authenticatedUser.id}:${new Date().toISOString().slice(0, 10)}`, userId: authenticatedUser.id, source: "api", properties: { module: "strategy", error_code: "PAID_FEATURE_LIMIT_REACHED" } }).catch(() => null);
      return res.status(402).json({ error: "PAID_FEATURE_LIMIT_REACHED", feature: "strategy", usage: paidFeature });
    }
  } else if (!privileged) {
    identity = anonymousIdentity(req);
    if (!identity) return res.status(400).json({ error: "ANONYMOUS_ID_REQUIRED" });
    let { data: rows, error: reserveError } = await supabase.rpc("reserve_strategy_trial", {
      target_device_hash: identity.deviceHash, target_user_id: authenticatedUser?.id || null,
      target_risk_hash: identity.riskHash, target_network_hash: identity.networkHash,
    });
    // Keep the API available while the strengthened database function is being
    // rolled out. Once the migration exists, the four-signal call is used.
    if (reserveError?.code === "PGRST202") {
      ({ data: rows, error: reserveError } = await supabase.rpc("reserve_strategy_trial", {
        target_device_hash: identity.deviceHash, target_user_id: authenticatedUser?.id || null,
      }));
    }
    if (reserveError) return res.status(500).json({ error: "CREDIT_CHECK_FAILED" });
    credit = rows?.[0];
    if (!credit?.allowed) {
      await tracking.record({ name: "strategy_paywall_triggered", businessKey: `strategy_paywall:${authenticatedUser?.id || identity.deviceHash}:${new Date().toISOString().slice(0, 10)}`, userId: authenticatedUser?.id || null, anonymousId: identity.deviceHash, source: "api", properties: { module: "strategy", error_code: credit?.reason || "TRIAL_LIMIT_REACHED" } }).catch(() => null);
      return res.status(402).json({ error: credit?.reason || "TRIAL_LIMIT_REACHED", trial: credit || null });
    }
  }
  const requestId = crypto.randomUUID();
  try {
    if(authenticatedUser){
      const [{data:recent},{data:savedLoveType}]=await Promise.all([supabase.from("analyses").select("title,result,completed_at").eq("user_id",authenticatedUser.id).eq("mode","analysis").eq("status","completed").order("completed_at",{ascending:false}).limit(2),supabase.from("love_type_profiles").select("*").eq("user_id",authenticatedUser.id).maybeSingle()]);
      cleaned.value.reusedContext=(recent||[]).map(item=>({title:item.title,summary:item.result?.summary||"",verdict:item.result?.verdict||"",nextSteps:item.result?.next_steps||[]}));
      if(savedLoveType)cleaned.value.userLoveProfile=withLoveTypeRuntimeMeta(mapLoveTypeProfile(savedLoveType));
    }
    const output = await generateStrategy(cleaned.value, locale);
    await tracking.record({ name: "ai_usage_completed", businessKey: `strategy_ai_usage_completed:${requestId}`, userId: authenticatedUser?.id || null, anonymousId: identity?.deviceHash || null, source: "ai", properties: { ...output.usage, module: "strategy", mode: "strategy", topic_id: cleaned.value.topic.id, anonymous: !authenticatedUser } });
    await tracking.record({name:"strategy_generation_succeeded",businessKey:`strategy_success:${requestId}`,userId:authenticatedUser?.id||null,anonymousId:identity?.deviceHash||null,source:"api",properties:{topic_id:cleaned.value.topic.id,weather_applied:Boolean(cleaned.value.weather),places_applied:Boolean(cleaned.value.verifiedPlaces.length),free_trial:Boolean(credit)}});
    return res.status(201).json({ result: output.result, trial: credit || null });
  } catch (error) {
    if (identity) try {
      const refund = await supabase.rpc("refund_strategy_trial", { target_device_hash: identity.deviceHash, target_user_id: authenticatedUser?.id || null, target_risk_hash: identity.riskHash });
      if (refund.error?.code === "PGRST202") await supabase.rpc("refund_strategy_trial", { target_device_hash: identity.deviceHash, target_user_id: authenticatedUser?.id || null });
    } catch {}
    if (paidFeature) await refundPaidFeature(authenticatedUser.id, "strategy");
    await tracking.record({ name: "ai_usage_failed", businessKey: `strategy_ai_usage_failed:${requestId}`, userId: authenticatedUser?.id || null, anonymousId: identity?.deviceHash || null, source: "ai", properties: { module: "strategy", mode: "strategy", topic_id: cleaned.value.topic.id, error_code: String(error.message || "AI_FAILED").slice(0, 80) } }).catch(() => null);
    await tracking.record({name:"strategy_generation_failed",businessKey:`strategy_failed:${requestId}`,userId:authenticatedUser?.id||null,anonymousId:identity?.deviceHash||null,source:"api",properties:{topic_id:cleaned.value.topic.id,external_status:cleaned.value.externalDataStatus}}).catch(()=>null);
    console.error("STRATEGY GENERATION FAILED", requestId, String(error.message || error));
    return res.status(502).json({ error: "GENERATION_FAILED" });
  }
});

app.get("/api/v1/analyses", requireUser, async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
  const { data, error } = await supabase.from("analyses")
    .select("id,mode,status,title,result,error_code,processing_ms,created_at,completed_at")
    .eq("user_id", req.user.id).order("created_at", { ascending: false }).limit(limit);
  if (error) return res.status(500).json({ error: "HISTORY_READ_FAILED" });
  res.json({ analyses: data });
});

app.post(
  "/api/v1/chat-extractions",
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "10mb" }),
  async (req, res) => {
    const mimeType = String(req.headers["content-type"] || "").split(";")[0];
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "IMAGE_REQUIRED" });
    if (!isSupportedImage(req.body, mimeType)) return res.status(415).json({ error: "INVALID_IMAGE_FILE" });
    // Version the fingerprint whenever the extraction contract changes so old
    // cached results cannot silently omit newly required evidence.
    const fingerprint = crypto.createHash("sha256").update("chat-extraction-v2-timestamps:").update(req.body).digest("hex");
    const { data: cached } = await supabase.from("chat_extraction_cache").select("result,expires_at")
      .eq("content_fingerprint", fingerprint).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (cached?.result?.messages) return res.json({ messages: cached.result.messages, cached: true });

    let actorKey;
    let actorPlan = "anonymous";
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (token) {
      const { data } = await supabase.auth.getUser(token);
      if (data?.user?.id) {
        actorKey = anonymousHash(`user:${data.user.id}`);
        const { data: profile } = await supabase.from("profiles").select("plan").eq("id", data.user.id).maybeSingle();
        actorPlan = profile?.plan === "pro" ? "pro" : "free";
      }
    }
    if (!actorKey) {
      const identity = anonymousIdentity(req);
      if (!identity) return res.status(400).json({ error: "ANONYMOUS_ID_REQUIRED" });
      actorKey = identity.deviceHash;
    }
    const configuredSuccessLimit = actorPlan === "pro"
      ? process.env.CHAT_EXTRACTION_PRO_DAILY_LIMIT
      : actorPlan === "free"
        ? process.env.CHAT_EXTRACTION_FREE_DAILY_LIMIT
        : process.env.CHAT_EXTRACTION_ANONYMOUS_DAILY_LIMIT;
    const configuredAttemptLimit = actorPlan === "pro"
      ? process.env.CHAT_EXTRACTION_PRO_ATTEMPT_DAILY_LIMIT
      : actorPlan === "free"
        ? process.env.CHAT_EXTRACTION_FREE_ATTEMPT_DAILY_LIMIT
        : process.env.CHAT_EXTRACTION_ANONYMOUS_ATTEMPT_DAILY_LIMIT;
    const defaultSuccessLimit = actorPlan === "pro" ? 20 : 5;
    const defaultAttemptLimit = actorPlan === "pro" ? 50 : 15;
    const successLimit = Math.max(1, Math.min(100, Number(configuredSuccessLimit || defaultSuccessLimit)));
    const attemptLimit = Math.max(successLimit, Math.min(500, Number(configuredAttemptLimit || defaultAttemptLimit)));
    let legacyReservation = false;
    let { data: attempt, error: attemptError } = await supabase.rpc("begin_chat_extraction_attempt", {
      target_actor_key: actorKey,
      success_limit: successLimit,
      attempt_limit: attemptLimit,
    });
    if (attemptError) {
      const fallback = await supabase.rpc("reserve_chat_extraction", {
        target_actor_key: actorKey,
        daily_limit: successLimit,
      });
      if (fallback.error) {
        console.error("CHAT EXTRACTION LIMIT CHECK FAILED", String(attemptError.message || attemptError), String(fallback.error.message || fallback.error));
        return res.status(500).json({ error: "EXTRACTION_LIMIT_CHECK_FAILED" });
      }
      legacyReservation = true;
      attempt = fallback.data?.map((row) => ({ ...row, attempts_used: row.used, reason: row.allowed ? null : "SUCCESS_LIMIT_REACHED" }));
    }
    if (!attempt?.[0]?.allowed) {
      const error = attempt?.[0]?.reason === "ATTEMPT_LIMIT_REACHED" ? "EXTRACTION_ATTEMPT_LIMIT_REACHED" : "EXTRACTION_LIMIT_REACHED";
      return res.status(429).json({ error });
    }

    const requestId = crypto.randomUUID();
    try {
      const output = await extractChatMessages({ imageBuffer: req.body, mimeType });
      if (!output.messages.length) return res.status(422).json({ error: "CHAT_NOT_READABLE" });
      const senders = new Set(output.messages.map((message) => message.sender));
      if (!senders.has("self") || !senders.has("partner")) {
        return res.status(422).json({ error: "CHAT_SIDES_NOT_READABLE" });
      }
      let completed = [{ recorded: true, successful: Number(attempt?.[0]?.used || 0) }];
      if (!legacyReservation) {
        const completion = await supabase.rpc("complete_chat_extraction_success", {
          target_actor_key: actorKey,
          success_limit: successLimit,
        });
        if (completion.error) return res.status(500).json({ error: "EXTRACTION_USAGE_RECORD_FAILED" });
        completed = completion.data;
        if (!completed?.[0]?.recorded) return res.status(429).json({ error: "EXTRACTION_LIMIT_REACHED" });
      }
      await supabase.from("chat_extraction_cache").upsert({
        content_fingerprint: fingerprint,
        result: { messages: output.messages },
        model_name: output.model,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
      await tracking.record({
        name: "ai_usage_completed", businessKey: `chat_extraction:${requestId}`,
        source: "ai", properties: { ...output.usage, mode: "reply" }
      });
      res.status(201).json({
        messages: output.messages,
        cached: false,
        limit: {
          plan: actorPlan,
          successfulDaily: successLimit,
          successfulUsed: Number(completed?.[0]?.successful || 0),
          attemptsDaily: attemptLimit,
          attemptsUsed: Number(attempt?.[0]?.attempts_used || 0),
        },
      });
    } catch (error) {
      console.error("CHAT EXTRACTION FAILED", requestId, String(error.message || error));
      res.status(502).json({ error: "CHAT_EXTRACTION_FAILED" });
    }
  }
);

app.get("/api/v1/analyses/:id", requireUser, async (req, res) => {
  const { data, error } = await supabase.from("analyses").select("*")
    .eq("id", req.params.id).eq("user_id", req.user.id).maybeSingle();
  if (error) return res.status(500).json({ error: "ANALYSIS_READ_FAILED" });
  if (!data) return res.status(404).json({ error: "NOT_FOUND" });
  res.json({ analysis: data });
});

app.delete("/api/v1/analyses/:id", requireUser, async (req, res) => {
  const { error } = await supabase.from("analyses").delete()
    .eq("id", req.params.id).eq("user_id", req.user.id);
  if (error) return res.status(500).json({ error: "ANALYSIS_DELETE_FAILED" });
  res.sendStatus(204);
});

app.post("/api/v1/consultations", requireUser, express.json({ limit: "8kb" }), async (req, res) => {
  const analysisId = String(req.body?.analysisId || "").trim() || null;
  const { data: profile, error: profileError } = await supabase.from("profiles").select("plan,role,is_test_account").eq("id", req.user.id).maybeSingle();
  if (profileError) return res.status(500).json({ error: "PROFILE_READ_FAILED" });
  const privileged = profile?.role === "admin" || Boolean(profile?.is_test_account);
  if (!privileged && profile?.plan !== "pro") return res.status(402).json({ error: "PRO_REQUIRED" });
  let analysis = null;
  if (analysisId) {
    const query = await supabase.from("analyses").select("id,relationship_id,result").eq("id", analysisId).eq("user_id", req.user.id).eq("status", "completed").maybeSingle();
    if (query.error) return res.status(500).json({ error: "ANALYSIS_READ_FAILED" });
    if (!query.data) return res.status(404).json({ error: "ANALYSIS_NOT_FOUND" });
    analysis = query.data;
  } else {
    const query = await supabase.from("analyses").select("id,relationship_id,result").eq("user_id", req.user.id).eq("mode", "analysis").eq("status", "completed").order("completed_at", { ascending: false }).limit(1).maybeSingle();
    analysis = query.data || null;
  }
  const relationship = analysis?.relationship_id ? { id: analysis.relationship_id } : await findActiveRelationship(req.user.id).then(result => result.data);
  const { data: thread, error } = await supabase.from("ai_consultation_threads").insert({
    user_id: req.user.id, relationship_id: relationship?.id || null, analysis_id: analysis?.id || null,
  }).select("id,title,analysis_id,created_at,updated_at").single();
  if (error) return res.status(500).json({ error: "CONSULTATION_CREATE_FAILED" });
  res.status(201).json({ thread });
});

app.get("/api/v1/consultations/:id/messages", requireUser, async (req, res) => {
  const { data: thread } = await supabase.from("ai_consultation_threads").select("id").eq("id", req.params.id).eq("user_id", req.user.id).maybeSingle();
  if (!thread) return res.status(404).json({ error: "CONSULTATION_NOT_FOUND" });
  const { data, error } = await supabase.from("ai_consultation_messages").select("id,role,content,created_at")
    .eq("thread_id", thread.id).eq("user_id", req.user.id).order("created_at", { ascending: true }).limit(100);
  if (error) return res.status(500).json({ error: "CONSULTATION_READ_FAILED" });
  res.json({ messages: data || [] });
});

app.post("/api/v1/consultations/:id/messages", requireUser, express.json({ limit: "8kb" }), async (req, res) => {
  const content = String(req.body?.content || "").trim().slice(0, 1500);
  const requestedLocale = String(req.body?.locale || "ja");
  const locale = ["ja", "zh-TW", "en"].includes(requestedLocale) ? requestedLocale : "ja";
  if (!content) return res.status(400).json({ error: "MESSAGE_REQUIRED" });
  const { data: profile } = await supabase.from("profiles").select("plan,billing_tier,role,is_test_account").eq("id", req.user.id).maybeSingle();
  const privileged = profile?.role === "admin" || Boolean(profile?.is_test_account);
  if (!privileged && profile?.plan !== "pro") return res.status(402).json({ error: "PRO_REQUIRED" });
  const { data: thread } = await supabase.from("ai_consultation_threads").select("id,analysis_id").eq("id", req.params.id).eq("user_id", req.user.id).maybeSingle();
  if (!thread) return res.status(404).json({ error: "CONSULTATION_NOT_FOUND" });
  let paidFeature = null;
  if (!privileged) {
    try { paidFeature = await reservePaidFeature(req.user.id, profile.billing_tier === "lite" ? "lite" : "premium", "analysis_consultation"); }
    catch { return res.status(500).json({ error: "PAID_USAGE_CHECK_FAILED" }); }
    if (!paidFeature.allowed) return res.status(429).json({ error: "CONSULTATION_MONTHLY_LIMIT_REACHED", usage: paidFeature });
  }
  let fairUse;
  try { fairUse = await usageService.check(req.user.id, "consultation"); }
  catch { return res.status(500).json({ error: "USAGE_CHECK_FAILED" }); }
  if (!fairUse.allowed) { if (paidFeature) await refundPaidFeature(req.user.id, "analysis_consultation"); return res.status(429).json({ error: "FAIR_USE_LIMIT_REACHED" }); }
  const [{ data: history }, { data: analysis }] = await Promise.all([
    supabase.from("ai_consultation_messages").select("role,content").eq("thread_id", thread.id).eq("user_id", req.user.id).order("created_at", { ascending: true }).limit(50),
    thread.analysis_id ? supabase.from("analyses").select("result").eq("id", thread.analysis_id).eq("user_id", req.user.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const userMessage = { role: "user", content };
  const { data: storedUser, error: userError } = await supabase.from("ai_consultation_messages").insert({ thread_id: thread.id, user_id: req.user.id, ...userMessage }).select("id,role,content,created_at").single();
  if (userError) { if (paidFeature) await refundPaidFeature(req.user.id, "analysis_consultation"); return res.status(500).json({ error: "CONSULTATION_MESSAGE_SAVE_FAILED" }); }
  try {
    const output = await createConsultationReply({ locale, analysisResult: analysis?.result || {}, messages: [...(history || []), userMessage] });
    const usage = output.usage || {};
    const { data: assistant, error: assistantError } = await supabase.from("ai_consultation_messages").insert({
      thread_id: thread.id, user_id: req.user.id, role: "assistant", content: output.content, model_name: output.model,
      input_tokens: Number(usage.prompt_tokens || 0), output_tokens: Number(usage.completion_tokens || 0),
    }).select("id,role,content,created_at").single();
    if (assistantError) throw new Error("CONSULTATION_MESSAGE_SAVE_FAILED");
    await Promise.all([
      supabase.from("ai_consultation_threads").update({ updated_at: new Date().toISOString() }).eq("id", thread.id).eq("user_id", req.user.id),
      usageService.recordSuccess(fairUse),
      tracking.record({ name: "ai_usage_completed", businessKey: `ai_consultation:${assistant.id}`, userId: req.user.id, source: "ai", properties: { ...usage, mode: "analysis" } }),
    ]);
    res.status(201).json({ userMessage: storedUser, assistantMessage: assistant });
  } catch (error) {
    console.error("AI CONSULTATION FAILED", thread.id, String(error.message || error));
    if (paidFeature) await refundPaidFeature(req.user.id, "analysis_consultation");
    res.status(502).json({ error: "CONSULTATION_FAILED" });
  }
});

app.post(
  "/api/v1/analyses",
  requireUser,
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "10mb" }),
  async (req, res) => {
    const mode = req.headers["x-analysis-mode"];
    const requestedLocale = String(req.headers["x-locale"] || "ja");
    const locale = ["ja", "zh-TW", "en"].includes(requestedLocale) ? requestedLocale : "ja";
    const mimeType = String(req.headers["content-type"] || "").split(";")[0];
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "IMAGE_REQUIRED" });
    if (!isSupportedImage(req.body, mimeType)) return res.status(415).json({ error: "INVALID_IMAGE_FILE" });
    if (!["reply", "analysis"].includes(mode)) return res.status(400).json({ error: "INVALID_MODE" });
    const replySettings = cleanReplySettings(req);
    if (mode === "reply" && replySettings.error) return res.status(400).json({ error: replySettings.error });
    const contentFingerprint = crypto.createHash("sha256").update(req.body).digest("hex");
    console.log("ANALYSIS_REQUEST_RECEIVED", req.user.id, mode, req.body.length);

    let fairUse;
    try {
      fairUse = await usageService.check(req.user.id, mode);
    } catch (error) {
      console.error("FAIR USE CHECK FAILED", String(error.message || error));
      return res.status(500).json({ error: "USAGE_CHECK_FAILED" });
    }
    if (!fairUse.allowed) return res.status(429).json({ error: "FAIR_USE_LIMIT_REACHED" });

    let credit = { allowed: true, plan: "pro", reserved: false };
    let paidFeature = null;
    if (fairUse.plan === "free") {
      const { data: creditRows, error: creditError } = await supabase.rpc("reserve_analysis_credit", { target_user_id: req.user.id });
      credit = { ...(creditRows?.[0] || {}), reserved: true };
      if (creditError) return res.status(500).json({ error: "CREDIT_CHECK_FAILED" });
      if (!credit?.allowed) return res.status(402).json({ error: "CREDIT_LIMIT_REACHED" });
    } else {
      const feature = mode === "reply" ? "reply" : "analysis_consultation";
      try {
        paidFeature = await reservePaidFeature(req.user.id, fairUse.tier, feature);
      } catch (error) {
        return res.status(500).json({ error: "PAID_USAGE_CHECK_FAILED" });
      }
      if (!paidFeature.allowed) return res.status(402).json({ error: "PAID_FEATURE_LIMIT_REACHED", feature, usage: paidFeature });
    }

    const { data: activeRelationship, error: relationshipError } = await findActiveRelationship(req.user.id);
    if (relationshipError || !activeRelationship) {
      if (credit.reserved) await supabase.rpc("refund_analysis_credit", { target_user_id: req.user.id, charged_plan: credit.plan });
      if (paidFeature) await refundPaidFeature(req.user.id, mode === "reply" ? "reply" : "analysis_consultation");
      return res.status(500).json({ error: "ACTIVE_RELATIONSHIP_NOT_FOUND" });
    }

    const { data: analysis, error: insertError } = await supabase.from("analyses").insert({
      user_id: req.user.id,
      relationship_id: activeRelationship.id,
      mode,
      status: "processing",
      title: mode === "reply" ? "返信アドバイス" : "チャット分析",
      input_metadata: { mime_type: mimeType, bytes: req.body.length, content_fingerprint: contentFingerprint, ...replySettings.value }
    }).select("id").single();

    if (insertError) {
      if (credit.reserved) await supabase.rpc("refund_analysis_credit", { target_user_id: req.user.id, charged_plan: credit.plan });
      if (paidFeature) await refundPaidFeature(req.user.id, mode === "reply" ? "reply" : "analysis_consultation");
      return res.status(500).json({ error: "ANALYSIS_CREATE_FAILED" });
    }

    await supabase.from("usage_events").insert({
      user_id: req.user.id, analysis_id: analysis.id, event_type: "analysis_started", credit_delta: -1,
      metadata: { charged_plan: credit.plan }
    });

    try {
      const [recentAnalysisQuery, recentEventsQuery] = await Promise.all([
        supabase.from("analyses").select("result,completed_at")
          .eq("relationship_id", activeRelationship.id).eq("user_id", req.user.id)
          .eq("mode", "analysis").eq("status", "completed")
          .order("completed_at", { ascending: false }).limit(1),
        supabase.from("timeline_events").select("event_date,title,source")
          .eq("relationship_id", activeRelationship.id).eq("user_id", req.user.id)
          .is("deleted_at", null).order("event_date", { ascending: false }).limit(5)
      ]);
      const priorResult = recentAnalysisQuery.data?.[0]?.result;
      const context = {
        priorAnalysis: recentAnalysisQuery.error ? "" : String(priorResult?.overallReason || priorResult?.summary || ""),
        recentEvents: recentEventsQuery.error ? [] : (recentEventsQuery.data || []).map((item) => ({
          date: item.event_date, title: item.title, source: item.source
        }))
      };
      const output = await analyzeForWeb({ imageBuffer: req.body, mimeType, mode, locale, context: { ...context, ...replySettings.value } });
      const completedAt = new Date().toISOString();
      await supabase.from("analyses").update({
        status: "completed", result: output.result, model_name: output.model,
        processing_ms: output.processingMs, completed_at: completedAt
      }).eq("id", analysis.id).eq("user_id", req.user.id);
      if (output.result.timelineEvent?.shouldRecord) {
        const timelineEvent = output.result.timelineEvent;
        const eventType = timelineEvent.eventType || "custom";
        const eventDate = timelineEvent.eventDate || completedAt.slice(0, 10);
        const originKey = `content:${contentFingerprint}`;
        const nearbyStart = new Date(`${eventDate}T00:00:00Z`);
        nearbyStart.setUTCDate(nearbyStart.getUTCDate() - 3);
        const nearbyEnd = new Date(`${eventDate}T00:00:00Z`);
        nearbyEnd.setUTCDate(nearbyEnd.getUTCDate() + 3);
        const [sameUpload, sameEvent] = await Promise.all([
          supabase.from("timeline_events").select("id,title,note").eq("relationship_id", activeRelationship.id)
            .eq("user_id", req.user.id).eq("source", "ai").eq("ai_origin_key", originKey).limit(1),
          supabase.from("timeline_events").select("id").eq("relationship_id", activeRelationship.id)
            .eq("user_id", req.user.id).eq("source", "ai").eq("event_type", eventType)
            .gte("event_date", nearbyStart.toISOString().slice(0, 10))
            .lte("event_date", nearbyEnd.toISOString().slice(0, 10))
            .is("deleted_at", null).limit(1)
        ]);
        if (sameUpload.error || sameEvent.error) {
          console.error("TIMELINE DEDUP CHECK FAILED", sameUpload.error?.message || sameEvent.error?.message);
        } else if (!sameUpload.data?.length && !(sameEvent.data || []).some((item) =>
          timelineTextSimilarity(item.title, timelineEvent.title) >= 0.72
          || (item.note && timelineEvent.note && timelineTextSimilarity(item.note, timelineEvent.note) >= 0.78)
        )) {
          const { error: timelineError } = await supabase.from("timeline_events").insert({
            relationship_id: activeRelationship.id,
            user_id: req.user.id,
            source: "ai",
            event_type: eventType,
            title: timelineEvent.title,
            event_date: eventDate,
            note: timelineEvent.note || null,
            analysis_id: analysis.id,
            ai_origin_key: originKey
          });
          if (timelineError && timelineError.code !== "23505") console.error("TIMELINE EVENT STORE FAILED", timelineError.message);
        }
      }
      await supabase.from("usage_events").insert({
        user_id: req.user.id, analysis_id: analysis.id, event_type: "analysis_completed",
        metadata: { processing_ms: output.processingMs, model: output.model }
      });
      await tracking.record({
        name: "ai_usage_completed", businessKey: `ai_usage_completed:${analysis.id}`,
        userId: req.user.id, source: "ai", properties: { ...output.usage, mode }
      });
      for (const [index, usage] of (output.auxiliaryUsages || []).entries()) {
        await tracking.record({
          name: "ai_usage_completed", businessKey: `ai_usage_completed:${analysis.id}:aux:${index}`,
          userId: req.user.id, source: "ai", properties: { ...usage, mode }
        });
      }
      await usageService.recordSuccess(fairUse);
      if (credit.plan === "free" && Number(credit.used) >= Number(credit.credit_limit)) {
        await tracking.record({
          name: "free_limit_reached", businessKey: `free_limit_reached:${req.user.id}`,
          userId: req.user.id, source: "ai",
          properties: { usage_count: Number(credit.used), usage_limit: Number(credit.credit_limit), plan: credit.plan }
        });
      }
      console.log("ANALYSIS_REQUEST_COMPLETED", analysis.id, mode, output.processingMs);
      res.status(201).json({ analysis: { id: analysis.id, mode, status: "completed", result: output.result, completed_at: completedAt }, usage: credit });
    } catch (error) {
      console.error("ANALYSIS_REQUEST_FAILED", analysis.id, mode, String(error.message || error));
      await Promise.all([
        supabase.from("analyses").update({ status: "failed", error_code: String(error.message || "AI_FAILED").slice(0, 80) }).eq("id", analysis.id).eq("user_id", req.user.id),
        credit.reserved
          ? supabase.rpc("refund_analysis_credit", { target_user_id: req.user.id, charged_plan: credit.plan })
          : Promise.resolve(),
        paidFeature ? refundPaidFeature(req.user.id, mode === "reply" ? "reply" : "analysis_consultation") : Promise.resolve(),
        supabase.from("usage_events").insert({ user_id: req.user.id, analysis_id: analysis.id, event_type: "analysis_failed", credit_delta: 1 })
      ]);
      await tracking.record({
        name: "ai_usage_failed", businessKey: `ai_usage_failed:${analysis.id}`,
        userId: req.user.id, source: "ai", properties: { mode, error_code: String(error.message || "AI_FAILED").slice(0, 80) }
      });
      res.status(502).json({ error: "ANALYSIS_FAILED", analysisId: analysis.id });
    }
  }
);

app.use((error, _req, res, _next) => {
  if (error?.type === "entity.too.large") return res.status(413).json({ error: "IMAGE_TOO_LARGE" });
  console.error("WEB API ERROR", error);
  res.status(500).json({ error: "INTERNAL_ERROR" });
});

app.listen(port, () => console.log(`RenAI Web API listening on ${port}`));
