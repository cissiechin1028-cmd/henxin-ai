require("dotenv").config();

const express = require("express");
const Stripe = require("stripe");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { analyzeForWeb } = require("./services/webAnalysis");
const { generateRelationshipReport, periodBounds } = require("./services/relationshipReports");
const { createTracking } = require("./tracking/service");

const app = express();
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

function isSupportedImage(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (mimeType === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (mimeType === "image/webp") return buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
  return false;
}

app.disable("x-powered-by");
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Analysis-Mode, X-Locale");
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
  req.user = data.user;
  next();
}

async function requireAdmin(req, res, next) {
  const { data } = await supabase.from("profiles").select("role").eq("id", req.user.id).maybeSingle();
  if (data?.role !== "admin") return res.status(403).json({ error: "ADMIN_REQUIRED" });
  next();
}

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

app.get("/health", (_req, res) => res.json({ ok: true, service: "renai-web-api" }));

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

app.post("/api/v1/billing/checkout", requireUser, express.json(), async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) return res.status(503).json({ error: "BILLING_NOT_CONFIGURED" });
  const { data: profile } = await supabase.from("profiles").select("stripe_customer_id,plan").eq("id", req.user.id).single();
  if (profile?.plan === "pro") return res.status(409).json({ error: "ALREADY_PRO" });
  const returnUrl = webAppReturnUrl(req);
  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: profile?.stripe_customer_id || undefined,
    customer_email: profile?.stripe_customer_id ? undefined : req.user.email,
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${returnUrl}?checkout=success`,
    cancel_url: `${returnUrl}?checkout=cancelled`,
    client_reference_id: req.user.id,
    metadata: { userId: req.user.id },
    subscription_data: { metadata: { userId: req.user.id } },
    allow_promotion_codes: true
  });
  await tracking.record({
    name: "checkout_started", businessKey: `checkout_started:${checkout.id}`,
    userId: req.user.id, source: "stripe", properties: { plan: "pro" }
  });
  res.json({ url: checkout.url });
});

app.post("/api/v1/billing/portal", requireUser, express.json(), async (req, res) => {
  const { data: profile } = await supabase.from("profiles").select("stripe_customer_id").eq("id", req.user.id).single();
  if (!profile?.stripe_customer_id) return res.status(404).json({ error: "BILLING_ACCOUNT_NOT_FOUND" });
  const portal = await stripe.billingPortal.sessions.create({ customer: profile.stripe_customer_id, return_url: webAppReturnUrl(req) });
  res.json({ url: portal.url });
});

app.post("/api/v1/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    await tracking.record({ name: "stripe_webhook_failed", businessKey: `stripe_webhook_failed:${Date.now()}:${Math.random()}`, source: "stripe", properties: { error_code: "INVALID_SIGNATURE" } });
    return res.status(400).send("Invalid signature");
  }
  const object = event.data.object;
  const userId = object.metadata?.userId || object.client_reference_id || null;
  const { error: eventInsertError } = await supabase.from("subscription_events").insert({
    user_id: userId, stripe_event_id: event.id, event_type: event.type,
    payload: { object_id: object.id, created: event.created }
  });
  if (eventInsertError?.code === "23505") return res.json({ received: true, duplicate: true });
  if (eventInsertError) return res.status(500).json({ error: "EVENT_STORE_FAILED" });
  if (event.type === "checkout.session.completed" && userId) {
    const subscription = object.subscription ? await stripe.subscriptions.retrieve(object.subscription) : null;
    await supabase.from("profiles").update({
      plan: "pro", stripe_customer_id: object.customer, stripe_subscription_id: object.subscription,
      subscription_status: subscription?.status || "active", pro_period_usage: 0,
      pro_period_start: subscription ? new Date(subscription.current_period_start * 1000).toISOString() : new Date().toISOString(),
      pro_period_end: subscription ? new Date(subscription.current_period_end * 1000).toISOString() : null
    }).eq("id", userId);
  }
  if (["invoice.paid", "invoice.payment_failed"].includes(event.type)) {
    const invoice = object;
    const subscription = invoice.subscription ? await stripe.subscriptions.retrieve(invoice.subscription) : null;
    const invoiceUserId = subscription?.metadata?.userId || userId;
    const price = subscription?.items?.data?.[0]?.price;
    const recurring = price?.recurring;
    const monthlyMinor = price?.unit_amount == null ? 0
      : recurring?.interval === "year" ? Math.round(price.unit_amount / 12)
        : recurring?.interval === "month" ? Math.round(price.unit_amount / Math.max(1, recurring.interval_count || 1)) : 0;
    if (event.type === "invoice.paid" && invoiceUserId) {
      const first = invoice.billing_reason === "subscription_create";
      await tracking.record({
        name: first ? "subscription_started" : "subscription_renewed",
        businessKey: `${first ? "subscription_started" : "subscription_renewed"}:${first ? invoice.subscription : invoice.id}`,
        userId: invoiceUserId, source: "stripe",
        properties: { currency: String(invoice.currency || price?.currency || "jpy").toUpperCase(), mrr_minor: monthlyMinor, invoice_reason: invoice.billing_reason }
      });
      await tracking.record({
        name: "user_plan_snapshot", businessKey: `user_plan_snapshot:${invoiceUserId}:${event.id}`,
        userId: invoiceUserId, source: "stripe",
        properties: { plan: "pro", subscription_status: subscription?.status || "active", currency: String(invoice.currency || "jpy").toUpperCase(), mrr_minor: monthlyMinor }
      });
    } else if (event.type === "invoice.payment_failed") {
      await tracking.record({
        name: "payment_failed", businessKey: `payment_failed:${invoice.id}`,
        userId: invoiceUserId, source: "stripe", properties: { currency: String(invoice.currency || "jpy").toUpperCase(), invoice_reason: invoice.billing_reason }
      });
    }
  }
  if (["customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
    const subscription = object;
    const subscriptionUserId = subscription.metadata?.userId;
    const active = ["active", "trialing"].includes(subscription.status);
    const update = {
      plan: active ? "pro" : "free", subscription_status: subscription.status,
      stripe_customer_id: subscription.customer, stripe_subscription_id: subscription.id,
      pro_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      pro_period_end: new Date(subscription.current_period_end * 1000).toISOString()
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
          plan: active ? "pro" : "free", subscription_status: subscription.status,
          currency: String(snapshotPrice?.currency || "jpy").toUpperCase(), mrr_minor: active ? snapshotMrr : 0
        }
      });
      if (event.type === "customer.subscription.deleted") {
        await tracking.record({ name: "subscription_cancelled", businessKey: `subscription_cancelled:${subscription.id}`, userId: resolvedUserId, source: "stripe", properties: { subscription_status: subscription.status } });
      }
    }
  }
  await tracking.record({ name: "stripe_webhook_processed", businessKey: `stripe_webhook_processed:${event.id}`, userId, source: "stripe", properties: { stripe_event_type: event.type } });
  res.json({ received: true });
});

app.get("/api/v1/admin/dashboard", requireUser, requireAdmin, async (req, res) => {
  const requestedTimeZone = String(req.query.timeZone || "Asia/Tokyo");
  const timeZone = ["Asia/Tokyo", "Asia/Taipei", "UTC"].includes(requestedTimeZone) ? requestedTimeZone : "Asia/Tokyo";
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const offset = timeZone === "UTC" ? "+00:00" : timeZone === "Asia/Taipei" ? "+08:00" : "+09:00";
  const dayStart = new Date(`${localDate}T00:00:00${offset}`).toISOString();
  const { data, error } = await supabase.rpc("developer_dashboard_summary", { day_start: dayStart });
  if (error) return res.status(500).json({ error: "DASHBOARD_READ_FAILED" });
  res.json({ ...data, timeZone, collectionNote: "Token and cost totals are accurate for AI calls recorded after this tracking migration." });
});

app.get("/api/v1/admin/summary", requireUser, requireAdmin, async (_req, res) => {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const [users, proUsers, analyses, failed] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("plan", "pro"),
    supabase.from("analyses").select("id", { count: "exact", head: true }).gte("created_at", since),
    supabase.from("analyses").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", since)
  ]);
  const analysisCount = analyses.count || 0;
  res.json({
    users: users.count || 0, proUsers: proUsers.count || 0, analyses30d: analysisCount,
    conversionRate: users.count ? Number((((proUsers.count || 0) / users.count) * 100).toFixed(1)) : 0,
    successRate: analysisCount ? Number((((analysisCount - (failed.count || 0)) / analysisCount) * 100).toFixed(1)) : 100
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
  if (!(analysisQuery.data?.length || eventQuery.data?.length)) {
    return res.status(422).json({ error: "REPORT_DATA_INSUFFICIENT" });
  }

  try {
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

app.get("/api/v1/analyses", requireUser, async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
  const { data, error } = await supabase.from("analyses")
    .select("id,mode,status,title,result,error_code,processing_ms,created_at,completed_at")
    .eq("user_id", req.user.id).order("created_at", { ascending: false }).limit(limit);
  if (error) return res.status(500).json({ error: "HISTORY_READ_FAILED" });
  res.json({ analyses: data });
});

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
    const contentFingerprint = crypto.createHash("sha256").update(req.body).digest("hex");

    const { data: creditRows, error: creditError } = await supabase.rpc("reserve_analysis_credit", { target_user_id: req.user.id });
    const credit = creditRows?.[0];
    if (creditError) return res.status(500).json({ error: "CREDIT_CHECK_FAILED" });
    if (!credit?.allowed) return res.status(402).json({ error: "CREDIT_LIMIT_REACHED", usage: credit });

    const { data: activeRelationship, error: relationshipError } = await findActiveRelationship(req.user.id);
    if (relationshipError || !activeRelationship) {
      await supabase.rpc("refund_analysis_credit", { target_user_id: req.user.id, charged_plan: credit.plan });
      return res.status(500).json({ error: "ACTIVE_RELATIONSHIP_NOT_FOUND" });
    }

    const { data: analysis, error: insertError } = await supabase.from("analyses").insert({
      user_id: req.user.id,
      relationship_id: activeRelationship.id,
      mode,
      status: "processing",
      title: mode === "reply" ? "返信アドバイス" : "チャット分析",
      input_metadata: { mime_type: mimeType, bytes: req.body.length, content_fingerprint: contentFingerprint }
    }).select("id").single();

    if (insertError) {
      await supabase.rpc("refund_analysis_credit", { target_user_id: req.user.id, charged_plan: credit.plan });
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
      const output = await analyzeForWeb({ imageBuffer: req.body, mimeType, mode, locale, context });
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
        const [sameUpload, sameEvent] = await Promise.all([
          supabase.from("timeline_events").select("id").eq("relationship_id", activeRelationship.id)
            .eq("user_id", req.user.id).eq("source", "ai").eq("ai_origin_key", originKey).limit(1),
          supabase.from("timeline_events").select("id").eq("relationship_id", activeRelationship.id)
            .eq("user_id", req.user.id).eq("source", "ai").eq("event_type", eventType)
            .eq("event_date", eventDate).eq("title", timelineEvent.title).limit(1)
        ]);
        if (sameUpload.error || sameEvent.error) {
          console.error("TIMELINE DEDUP CHECK FAILED", sameUpload.error?.message || sameEvent.error?.message);
        } else if (!sameUpload.data?.length && !sameEvent.data?.length) {
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
      await tracking.record({
        name: "first_ai_usage_completed", businessKey: `first_ai_usage_completed:${req.user.id}`,
        userId: req.user.id, source: "ai", properties: { mode }
      });
      if (credit.plan === "free" && Number(credit.used) >= Number(credit.credit_limit)) {
        await tracking.record({
          name: "free_limit_reached", businessKey: `free_limit_reached:${req.user.id}`,
          userId: req.user.id, source: "ai",
          properties: { usage_count: Number(credit.used), usage_limit: Number(credit.credit_limit), plan: credit.plan }
        });
      }
      res.status(201).json({ analysis: { id: analysis.id, mode, status: "completed", result: output.result, completed_at: completedAt }, usage: credit });
    } catch (error) {
      await Promise.all([
        supabase.from("analyses").update({ status: "failed", error_code: String(error.message || "AI_FAILED").slice(0, 80) }).eq("id", analysis.id).eq("user_id", req.user.id),
        supabase.rpc("refund_analysis_credit", { target_user_id: req.user.id, charged_plan: credit.plan }),
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
