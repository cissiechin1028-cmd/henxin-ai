const crypto = require("crypto");

const SAFE_PROPERTY_KEYS = new Set([
  "path", "method", "status_code", "duration_ms", "mode", "feature", "model",
  "prompt_tokens", "cached_tokens", "completion_tokens", "total_tokens", "cost_micros",
  "cost_status", "plan", "subscription_status", "currency", "mrr_minor", "invoice_reason",
  "stripe_event_type", "error_code", "usage_count", "usage_limit"
]);

function environment() {
  const value = String(process.env.TRACKING_ENVIRONMENT || process.env.NODE_ENV || "development").toLowerCase();
  return ["development", "test", "staging", "production"].includes(value) ? value : "development";
}

function safeProperties(input = {}) {
  return Object.fromEntries(Object.entries(input).filter(([key, value]) =>
    SAFE_PROPERTY_KEYS.has(key) && value !== undefined && value !== null &&
    ["string", "number", "boolean"].includes(typeof value)
  ));
}

function createTracking({ supabase }) {
  async function record({ name, businessKey, userId = null, anonymousId = null, source = "api", properties = {}, occurredAt }) {
    if (!name || !businessKey) return null;
    const payload = {
      event_id: crypto.randomUUID(), event_name: name, business_key: String(businessKey).slice(0, 500),
      user_id: userId, anonymous_id: anonymousId, source,
      environment: environment(), properties: safeProperties(properties),
      occurred_at: occurredAt || new Date().toISOString()
    };
    try {
      const { data, error } = await supabase.from("tracking_events").upsert(payload, {
        onConflict: "business_key", ignoreDuplicates: true
      }).select("id,event_id,event_name,business_key").maybeSingle();
      if (error && error.code !== "23505" && error.code !== "42P01") {
        console.error("TRACKING STORE FAILED", error.message);
      }
      return data || null;
    } catch (error) {
      console.error("TRACKING STORE FAILED", String(error.message || error));
      return null;
    }
  }

  function requestMiddleware(req, res, next) {
    const started = Date.now();
    res.on("finish", () => {
      if (!req.path.startsWith("/api/") || req.path.startsWith("/api/v1/admin/")) return;
      const status = res.statusCode;
      const common = {
        businessKey: `api:${crypto.randomUUID()}`, userId: req.user?.id || null, source: "api",
        properties: { method: req.method, path: req.route?.path || req.path, status_code: status, duration_ms: Date.now() - started }
      };
      void record({ ...common, name: "api_request_completed" });
      if (status >= 500) void record({ ...common, name: "api_request_failed", businessKey: `api-failed:${crypto.randomUUID()}` });
    });
    next();
  }

  return { record, requestMiddleware };
}

module.exports = { createTracking, safeProperties };
