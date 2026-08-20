const test = require("node:test");
const assert = require("node:assert/strict");
const Stripe = require("stripe");
const { constructStripeWebhookEvent, webhookSecretCandidates } = require("../services/stripeWebhook");

const stripe = new Stripe("sk_test_placeholder");
const testSecret = "whsec_test_fixture";
const liveSecret = "whsec_live_fixture";

function signedPayload(event, secret) {
  const raw = Buffer.from(JSON.stringify(event));
  const signature = stripe.webhooks.generateTestHeaderString({ payload: raw.toString(), secret });
  return { raw, signature };
}

test("verifies test and live events with their independent secrets", () => {
  const env = { STRIPE_TEST_WEBHOOK_SECRET: testSecret, STRIPE_LIVE_WEBHOOK_SECRET: liveSecret };
  const testPayload = signedPayload({ id: "evt_test", object: "event", livemode: false }, testSecret);
  const livePayload = signedPayload({ id: "evt_live", object: "event", livemode: true }, liveSecret);

  assert.equal(constructStripeWebhookEvent(stripe, testPayload.raw, testPayload.signature, env).mode, "test");
  assert.equal(constructStripeWebhookEvent(stripe, livePayload.raw, livePayload.signature, env).mode, "live");
});

test("rejects a secret assigned to the wrong Stripe mode", () => {
  const env = { STRIPE_TEST_WEBHOOK_SECRET: testSecret, STRIPE_LIVE_WEBHOOK_SECRET: liveSecret };
  const mislabeled = signedPayload({ id: "evt_wrong_mode", object: "event", livemode: true }, testSecret);
  assert.throws(() => constructStripeWebhookEvent(stripe, mislabeled.raw, mislabeled.signature, env), /SIGNATURE_INVALID/);
});

test("uses the legacy secret only when no mode-specific secrets exist", () => {
  assert.deepEqual(webhookSecretCandidates({
    STRIPE_WEBHOOK_SECRET: "legacy",
    STRIPE_TEST_WEBHOOK_SECRET: "test"
  }).map(({ mode }) => mode), ["test", "live"]);
  assert.deepEqual(webhookSecretCandidates({ STRIPE_WEBHOOK_SECRET: "legacy" }).map(({ mode }) => mode), ["legacy"]);
});

test("normalizes copied secret whitespace and wrapping quotes", () => {
  assert.deepEqual(webhookSecretCandidates({
    STRIPE_TEST_WEBHOOK_SECRET: `  "${testSecret}"\n`,
    STRIPE_WEBHOOK_SECRET: ` ${liveSecret} `
  }), [
    { mode: "test", secret: testSecret },
    { mode: "live", secret: liveSecret }
  ]);
});
