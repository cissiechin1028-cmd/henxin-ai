function webhookSecretCandidates(env = process.env) {
  const candidates = [];
  if (env.STRIPE_TEST_WEBHOOK_SECRET) candidates.push({ mode: "test", secret: env.STRIPE_TEST_WEBHOOK_SECRET });
  if (env.STRIPE_LIVE_WEBHOOK_SECRET) candidates.push({ mode: "live", secret: env.STRIPE_LIVE_WEBHOOK_SECRET });
  if (!candidates.length && env.STRIPE_WEBHOOK_SECRET) candidates.push({ mode: "legacy", secret: env.STRIPE_WEBHOOK_SECRET });
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
