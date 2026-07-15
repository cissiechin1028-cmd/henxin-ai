require("dotenv").config();

const express = require("express");
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const { analyzeForWeb } = require("./services/webAnalysis");

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
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Analysis-Mode");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

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

app.get("/api/v1/me", requireUser, async (req, res) => {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", req.user.id).single();
  if (error) return res.status(500).json({ error: "PROFILE_READ_FAILED" });
  res.json({ profile: data });
});

app.post("/api/v1/billing/checkout", requireUser, express.json(), async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) return res.status(503).json({ error: "BILLING_NOT_CONFIGURED" });
  const { data: profile } = await supabase.from("profiles").select("stripe_customer_id,plan").eq("id", req.user.id).single();
  if (profile?.plan === "pro") return res.status(409).json({ error: "ALREADY_PRO" });
  const origin = allowedOrigins[0];
  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: profile?.stripe_customer_id || undefined,
    customer_email: profile?.stripe_customer_id ? undefined : req.user.email,
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${origin}/?checkout=success`,
    cancel_url: `${origin}/?checkout=cancelled`,
    client_reference_id: req.user.id,
    metadata: { userId: req.user.id },
    subscription_data: { metadata: { userId: req.user.id } },
    allow_promotion_codes: true
  });
  res.json({ url: checkout.url });
});

app.post("/api/v1/billing/portal", requireUser, async (req, res) => {
  const { data: profile } = await supabase.from("profiles").select("stripe_customer_id").eq("id", req.user.id).single();
  if (!profile?.stripe_customer_id) return res.status(404).json({ error: "BILLING_ACCOUNT_NOT_FOUND" });
  const portal = await stripe.billingPortal.sessions.create({ customer: profile.stripe_customer_id, return_url: `${allowedOrigins[0]}/` });
  res.json({ url: portal.url });
});

app.post("/api/v1/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
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
  }
  res.json({ received: true });
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
    const mimeType = String(req.headers["content-type"] || "").split(";")[0];
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "IMAGE_REQUIRED" });
    if (!isSupportedImage(req.body, mimeType)) return res.status(415).json({ error: "INVALID_IMAGE_FILE" });
    if (!["reply", "analysis"].includes(mode)) return res.status(400).json({ error: "INVALID_MODE" });

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
      input_metadata: { mime_type: mimeType, bytes: req.body.length }
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
      const output = await analyzeForWeb({ imageBuffer: req.body, mimeType, mode });
      const completedAt = new Date().toISOString();
      await supabase.from("analyses").update({
        status: "completed", result: output.result, model_name: output.model,
        processing_ms: output.processingMs, completed_at: completedAt
      }).eq("id", analysis.id).eq("user_id", req.user.id);
      if (mode === "analysis" && output.result.timelineEvent?.shouldRecord) {
        const timelineEvent = output.result.timelineEvent;
        const { error: timelineError } = await supabase.from("timeline_events").insert({
          relationship_id: activeRelationship.id,
          user_id: req.user.id,
          source: "ai",
          event_type: timelineEvent.eventType || "custom",
          title: timelineEvent.title,
          event_date: completedAt.slice(0, 10),
          note: timelineEvent.note || null,
          analysis_id: analysis.id,
          ai_origin_key: `analysis:${analysis.id}`
        });
        if (timelineError) console.error("TIMELINE EVENT STORE FAILED", timelineError.message);
      }
      await supabase.from("usage_events").insert({
        user_id: req.user.id, analysis_id: analysis.id, event_type: "analysis_completed",
        metadata: { processing_ms: output.processingMs, model: output.model }
      });
      res.status(201).json({ analysis: { id: analysis.id, mode, status: "completed", result: output.result, completed_at: completedAt }, usage: credit });
    } catch (error) {
      await Promise.all([
        supabase.from("analyses").update({ status: "failed", error_code: String(error.message || "AI_FAILED").slice(0, 80) }).eq("id", analysis.id).eq("user_id", req.user.id),
        supabase.rpc("refund_analysis_credit", { target_user_id: req.user.id, charged_plan: credit.plan }),
        supabase.from("usage_events").insert({ user_id: req.user.id, analysis_id: analysis.id, event_type: "analysis_failed", credit_delta: 1 })
      ]);
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
