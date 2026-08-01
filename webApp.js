require("dotenv").config();

const express = require("express");
const Stripe = require("stripe");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { analyzeForWeb } = require("./services/webAnalysis");
const { generateRelationshipReport, periodBounds } = require("./services/relationshipReports");
const { createTracking } = require("./tracking/service");
const { createUsageService } = require("./services/usageService");

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
const usageService = createUsageService({ supabase });
const dashboardStatsStartAt = new Date(process.env.ADMIN_STATS_START_AT || "2026-08-01T10:00:00.000Z").toISOString();

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "").trim().toLowerCase()).digest("hex");
}

function subscriptionPeriod(subscription) {
  const item = subscription?.items?.data?.[0];
  return {
    start: subscription?.current_period_start || item?.current_period_start || null,
    end: subscription?.current_period_end || item?.current_period_end || null
  };
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
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Analysis-Mode, X-Locale, X-Reply-Goal, X-Reply-Style, X-Relationship-Status");
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

function cleanReplySettings(req) {
  const replyGoal = String(req.headers["x-reply-goal"] || "").trim().slice(0, 150);
  const replyStyle = String(req.headers["x-reply-style"] || "natural").trim();
  const relationshipStatus = String(req.headers["x-relationship-status"] || "").trim();
  const styleAliases = { reassure: "gentle" };
  const statusAliases = { unknown: "", crush: "interested", talking: "in_contact", pre_relationship: "in_contact", cold: "", conflict: "", breakup: "ex", reconciliation: "ex" };
  const allowedGoals = new Set(["", "continue_conversation", "get_closer", "understand_feelings", "clear_misunderstanding", "make_up", "lead_to_date", "express_feelings", "decline_politely"]);
  const allowedStyles = new Set(["natural", "get_closer", "gentle", "humor", "amaeru", "honest", "distance"]);
  const allowedStatuses = new Set(["", "interested", "in_contact", "dating", "long_term", "ex"]);
  const normalizedStyle = styleAliases[replyStyle] || replyStyle;
  const normalizedStatus = statusAliases[relationshipStatus] ?? relationshipStatus;
  return {
    value: {
      replyGoal: allowedGoals.has(replyGoal) ? replyGoal : "",
      replyStyle: allowedStyles.has(normalizedStyle) ? normalizedStyle : "natural",
      relationshipStatus: allowedStatuses.has(normalizedStatus) ? normalizedStatus : "",
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
  "free_trial_clicked", "login_opened", "google_login_succeeded", "line_login_succeeded",
  "google_login_clicked", "line_login_clicked", "email_input_started",
  "email_login_succeeded", "google_login_failed", "line_login_failed", "email_otp_failed",
  "first_screenshot_uploaded", "upgrade_clicked", "stripe_checkout_opened", "attribution_linked"
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

app.post("/api/v1/billing/checkout", requireUser, express.json(), async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) return res.status(503).json({ error: "BILLING_NOT_CONFIGURED" });
  const { data: profile } = await supabase.from("profiles").select("stripe_customer_id,plan").eq("id", req.user.id).single();
  if (profile?.plan === "pro") return res.status(409).json({ error: "ALREADY_PRO" });
  const returnUrl = webAppReturnUrl(req);
  const checkoutLocale = { ja: "ja", "zh-TW": "zh-TW", en: "en" }[String(req.body?.locale || "")] || "ja";
  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    locale: checkoutLocale,
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
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    // Public webhook URLs are routinely probed by bots and uptime scanners. A
    // request without Stripe's signature is not a failed Stripe delivery.
    if (req.headers["stripe-signature"]) {
      await tracking.record({ name: "stripe_webhook_failed", businessKey: `stripe_webhook_failed:${Date.now()}:${Math.random()}`, source: "stripe", properties: { error_code: "INVALID_SIGNATURE" } });
    }
    return res.status(400).send("Invalid signature");
  }
  const object = event.data.object;
  const userId = object.metadata?.userId || object.client_reference_id || null;
  const { error: eventInsertError } = await supabase.from("subscription_events").insert({
    user_id: userId, stripe_event_id: event.id, event_type: event.type,
    payload: { object_id: object.id, created: event.created }
  });
  if (eventInsertError && eventInsertError.code !== "23505") {
    return res.status(500).json({ error: "EVENT_STORE_FAILED" });
  }
  try {
    if (event.type === "checkout.session.completed" && userId && object.payment_status === "paid") {
      const subscriptionId = typeof object.subscription === "string" ? object.subscription : object.subscription?.id;
      const subscription = subscriptionId ? await stripe.subscriptions.retrieve(subscriptionId) : null;
      const period = subscriptionPeriod(subscription);
      await requireProfileUpdate(userId, {
        plan: "pro", stripe_customer_id: object.customer, stripe_subscription_id: subscriptionId,
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
    const recurring = price?.recurring;
    const monthlyMinor = price?.unit_amount == null ? 0
      : recurring?.interval === "year" ? Math.round(price.unit_amount / 12)
        : recurring?.interval === "month" ? Math.round(price.unit_amount / Math.max(1, recurring.interval_count || 1)) : 0;
    if (event.type === "invoice.paid" && invoiceUserId) {
      const first = invoice.billing_reason === "subscription_create";
      const period = subscriptionPeriod(subscription);
      await requireProfileUpdate(invoiceUserId, {
        plan: "pro", stripe_customer_id: invoice.customer, stripe_subscription_id: subscriptionId,
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
        properties: { plan: "pro", subscription_status: subscription?.status || "active", currency: String(invoice.currency || "jpy").toUpperCase(), mrr_minor: monthlyMinor }
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
    if (["customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
    const subscription = object;
    const subscriptionUserId = subscription.metadata?.userId;
    const active = ["active", "trialing"].includes(subscription.status);
    const period = subscriptionPeriod(subscription);
    const update = {
      plan: active ? "pro" : "free", subscription_status: subscription.status,
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

app.get("/api/v1/admin/dashboard", requireUser, requireAdmin, async (req, res) => {
  const requestedTimeZone = String(req.query.timeZone || "Asia/Tokyo");
  const timeZone = ["Asia/Tokyo", "Asia/Taipei", "UTC"].includes(requestedTimeZone) ? requestedTimeZone : "Asia/Tokyo";
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const offset = timeZone === "UTC" ? "+00:00" : timeZone === "Asia/Taipei" ? "+08:00" : "+09:00";
  const dayStart = new Date(`${localDate}T00:00:00${offset}`).toISOString();
  const requestedStart = Date.parse(String(req.query.startAt || dayStart));
  const requestedEnd = Date.parse(String(req.query.endAt || new Date().toISOString()));
  const periodStart = new Date(Math.max(Date.parse(dashboardStatsStartAt), Number.isFinite(requestedStart) ? requestedStart : Date.parse(dayStart))).toISOString();
  const periodEnd = new Date(Math.min(Date.now(), Number.isFinite(requestedEnd) ? requestedEnd : Date.now())).toISOString();
  if (periodStart >= periodEnd) return res.status(400).json({ error: "INVALID_DASHBOARD_PERIOD" });
  const { data, error } = await supabase.rpc("developer_dashboard_summary", { day_start: dayStart });
  if (error) return res.status(500).json({ error: "DASHBOARD_READ_FAILED" });
  const [profilesResult, analyses30d, eventsResult, usageResult, authResult, attributionResult] = await Promise.all([
    supabase.from("profiles").select("id,display_name,plan,lifetime_free_usage,pro_period_usage,subscription_status,role,is_test_account,created_at"),
    supabase.from("analyses").select("id,user_id,status").gte("created_at", periodStart).lt("created_at", periodEnd),
    trackingEventsBetween(periodStart, periodEnd),
    supabase.from("ai_usage_periods").select("user_id,used_units,budget_units,updated_at"),
    supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    supabase.from("user_ad_attributions").select("user_id,source,medium,campaign,campaign_id,ad_group,ad_group_id,ad,ad_id,creative_id,utm_content,utm_term,placement,ttclid,landing_page,captured_at")
  ]);
  const allProfiles = profilesResult.data || [];
  const profiles = allProfiles.filter((profile) => profile.role !== "admin" && !profile.is_test_account);
  if (eventsResult.error) return res.status(500).json({ error: "DASHBOARD_EVENTS_READ_FAILED" });
  const events = eventsResult.data || [];
  const authUsers = authResult.data?.users || [];
  const authById = new Map(authUsers.map((user) => [user.id, user]));
  const customerIds = new Set(profiles.map((profile) => profile.id));
  const attributionByUser = new Map((attributionResult.data || []).filter((item) => customerIds.has(item.user_id)).map((item) => [item.user_id, item]));
  const excludedUserIds = new Set(allProfiles.filter((profile) => profile.role === "admin" || profile.is_test_account).map((profile) => profile.id));
  const excludedAnonymousIds = new Set(events
    .filter((event) => event.anonymous_id && event.user_id && excludedUserIds.has(event.user_id))
    .map((event) => event.anonymous_id));
  const operationalEvents = events.filter((event) =>
    (!event.user_id || customerIds.has(event.user_id)) &&
    (!event.anonymous_id || !excludedAnonymousIds.has(event.anonymous_id))
  );
  const aiEvents = operationalEvents.filter((event) => event.event_name === "ai_usage_completed");
  const aiCalls = aiEvents.length;
  const aiTokens = aiEvents.reduce((sum, event) => sum + Number(event.properties?.total_tokens || 0), 0);
  const aiCostMicros = aiEvents.reduce((sum, event) => sum + Number(event.properties?.cost_micros || 0), 0);
  const pricingUnconfigured = aiEvents.filter((event) => event.properties?.cost_status === "unconfigured").length;
  const funnelNames = [
    "page_viewed", "free_trial_clicked", "login_opened", "google_login_clicked", "line_login_clicked", "email_input_started", "google_login_succeeded",
    "line_login_succeeded", "email_login_succeeded", "first_screenshot_uploaded",
    "first_ai_usage_completed", "upgrade_clicked", "stripe_checkout_opened", "subscription_started"
  ];
  const funnelActors = new Map(funnelNames.map((name) => [name, new Set()]));
  for (const event of operationalEvents) {
    const actors = funnelActors.get(event.event_name);
    if (!actors) continue;
    const actor = event.user_id || event.anonymous_id;
    if (actor) actors.add(actor);
  }
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
  const costForMode = (mode) => events.filter((event) => event.event_name === "ai_usage_completed" && event.properties?.mode === mode)
    .reduce((sum, event) => sum + Number(event.properties?.cost_micros || 0), 0);
  const errorEvents = events.filter((event) => ["api_request_failed", "ai_usage_failed", "stripe_webhook_failed", "payment_failed", "google_login_failed", "line_login_failed", "email_otp_failed"].includes(event.event_name)).slice(-100).reverse();
  const revenue = (start) => events.filter((event) => ["subscription_started", "subscription_renewed"].includes(event.event_name) && event.occurred_at >= start)
    .reduce((sum, event) => sum + Number(event.properties?.revenue_minor || 0), 0);
  const refunds = events.filter((event) => event.event_name === "payment_refunded");
  const usageById = new Map((usageResult.data || []).map((usage) => [usage.user_id, usage]));
  const users = profiles.map((profile) => {
    const auth = authById.get(profile.id);
    const provider = auth?.app_metadata?.provider || auth?.identities?.[0]?.provider || "email";
    const totalCostMicros = events.filter((event) => event.user_id === profile.id && event.event_name === "ai_usage_completed")
      .reduce((sum, event) => sum + Number(event.properties?.cost_micros || 0), 0);
    const fair = usageById.get(profile.id);
    return { id: profile.id, email: auth?.email || "", displayName: profile.display_name, createdAt: profile.created_at,
      provider, plan: profile.plan, lifetimeUsage: profile.lifetime_free_usage, lastSignInAt: auth?.last_sign_in_at || null,
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
    if (!event.user_id) continue;
    const group = groupForUser(event.user_id);
    if (!group) continue;
    if (event.event_name === "first_screenshot_uploaded") group.uploads.add(event.user_id);
    if (event.event_name === "first_ai_usage_completed") group.analyses.add(event.user_id);
    if (event.event_name === "subscription_started") group.payments.add(event.user_id);
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
      averageAnalysisCostMicros: aiCalls ? Math.round(aiCostMicros / aiCalls) : 0,
      replyCostMicros: costForMode("reply"), analysisCostMicros: costForMode("analysis") },
    payments: { todayRevenueMinor: revenue(periodStart), monthRevenueMinor: revenue(periodStart),
      newSubscriptions: operationalEvents.filter((event) => event.event_name === "subscription_started").length,
      cancellations: operationalEvents.filter((event) => event.event_name === "subscription_cancelled").length, refunds: refunds.length,
      refundMinor: refunds.reduce((sum, event) => sum + Number(event.properties?.revenue_minor || 0), 0),
      mrrMinor: revenue(periodStart), currency: data.subscriptions.currency },
    errors: errorEvents.map((event) => ({ id: event.id, type: event.event_name, source: event.source, code: event.properties?.error_code || null,
      message: event.properties?.failure_message || null, statusCode: event.properties?.status_code || null, occurredAt: event.occurred_at })),
    users, creativeFunnels, collectionNote: `统计范围：${periodStart} 至 ${periodEnd}；最早起点固定为 2026 年 8 月 1 日 19:00（东京时间）。` });
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
    if (fairUse.plan === "free") {
      const { data: creditRows, error: creditError } = await supabase.rpc("reserve_analysis_credit", { target_user_id: req.user.id });
      credit = { ...(creditRows?.[0] || {}), reserved: true };
      if (creditError) return res.status(500).json({ error: "CREDIT_CHECK_FAILED" });
      if (!credit?.allowed) return res.status(402).json({ error: "CREDIT_LIMIT_REACHED" });
    }

    const { data: activeRelationship, error: relationshipError } = await findActiveRelationship(req.user.id);
    if (relationshipError || !activeRelationship) {
      if (credit.reserved) await supabase.rpc("refund_analysis_credit", { target_user_id: req.user.id, charged_plan: credit.plan });
      return res.status(500).json({ error: "ACTIVE_RELATIONSHIP_NOT_FOUND" });
    }

    const { data: analysis, error: insertError } = await supabase.from("analyses").insert({
      user_id: req.user.id,
      relationship_id: activeRelationship.id,
      mode,
      status: "processing",
      title: mode === "reply" ? "返信アドバイス" : "チャット分析",
      input_metadata: { mime_type: mimeType, bytes: req.body.length, content_fingerprint: contentFingerprint, ...(mode === "reply" ? replySettings.value : {}) }
    }).select("id").single();

    if (insertError) {
      if (credit.reserved) await supabase.rpc("refund_analysis_credit", { target_user_id: req.user.id, charged_plan: credit.plan });
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
      const output = await analyzeForWeb({ imageBuffer: req.body, mimeType, mode, locale, context: { ...context, ...(mode === "reply" ? replySettings.value : {}) } });
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
      await tracking.record({
        name: "first_ai_usage_completed", businessKey: `first_ai_usage_completed:${req.user.id}`,
        userId: req.user.id, source: "ai", properties: { mode }
      });
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
