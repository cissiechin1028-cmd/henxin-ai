function webhookSecretCandidates(env = process.env) {
  const clean = (value) => {
    const trimmed = String(value || "").trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1).trim();
    }
    return trimmed;
  };
  const candidates = [];
  const testSecret = clean(env.STRIPE_TEST_WEBHOOK_SECRET);
  const liveSecret = clean(env.STRIPE_LIVE_WEBHOOK_SECRET);
  const legacySecret = clean(env.STRIPE_WEBHOOK_SECRET);
  if (testSecret) candidates.push({ mode: "test", secret: testSecret });
  if (liveSecret) candidates.push({ mode: "live", secret: liveSecret });
  // Keep the existing Live secret working during the zero-downtime migration.
  // Once STRIPE_LIVE_WEBHOOK_SECRET is configured, the legacy name is ignored.
  if (!liveSecret && legacySecret) {
    candidates.push({ mode: testSecret ? "live" : "legacy", secret: legacySecret });
  }
  return candidates;
}

function constructStripeWebhookEvent(stripe, rawBody, signature, env = process.env) {
  const candidates = webhookSecretCandidates(env);
  if (!candidates.length) throw new Error("STRIPE_WEBHOOK_SECRET_NOT_CONFIGURED");

  for (const candidate of candidates) {
    try {
      const event = stripe.webhooks.constructEvent(rawBody, signature, candidate.secret);
      if (candidate.mode === "test" && event.livemode) continue;
      if (candidate.mode === "live" && !event.livemode) continue;
      return { event, mode: candidate.mode };
    } catch {
      // Try the other explicitly configured mode without exposing secret values.
    }
  }
  throw new Error("STRIPE_WEBHOOK_SIGNATURE_INVALID");
}

module.exports = { constructStripeWebhookEvent, webhookSecretCandidates };
