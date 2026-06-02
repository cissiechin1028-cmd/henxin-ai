const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log("SUPABASE_URL EXISTS:", Boolean(supabaseUrl));
console.log("SUPABASE_KEY EXISTS:", Boolean(supabaseKey));

const supabase = createClient(supabaseUrl, supabaseKey);

function createUser() {
  return {
    usageCount: 0,
    replyUsageCount: 0,
    plan: "free",

    privacyAccepted: false,
    privacyAcceptedAt: null,
    ageConfirmed: false,
    ageConfirmedAt: null,

    pendingClarify: false,
    pendingText: null,

    lastInput: null,
    lastInputType: null,
    lastScenario: null,
    lastAdvice: null,
    lastRiskLevel: 1,

    conversationSummary: null,
    lastChatContext: null,

    contactAllowed: undefined,
    recommendedAction: undefined,
    mainRisk: undefined,
    paywall: false,

    stripeCustomerId: null,
    stripeSubscriptionId: null
  };
}

function fromDb(row = {}) {
  return {
    usageCount: row.usage_count ?? 0,
    replyUsageCount: row.reply_usage_count ?? 0,
    plan: row.plan || "free",

    privacyAccepted: row.privacy_accepted ?? false,
    privacyAcceptedAt: row.privacy_accepted_at ?? null,
    ageConfirmed: row.age_confirmed ?? false,
    ageConfirmedAt: row.age_confirmed_at ?? null,

    pendingClarify: row.pending_clarify ?? false,
    pendingText: row.pending_text ?? null,

    lastInput: row.last_input ?? null,
    lastInputType: row.last_input_type ?? null,
    lastScenario: row.last_scenario ?? null,
    lastAdvice: row.last_advice ?? null,
    lastRiskLevel: row.last_risk_level ?? 1,

    conversationSummary: row.conversation_summary ?? null,
    lastChatContext: row.last_chat_context ?? null,

    contactAllowed: row.contact_allowed ?? undefined,
    recommendedAction: row.recommended_action ?? undefined,
    mainRisk: row.main_risk ?? undefined,
    paywall: row.paywall ?? false,

    stripeCustomerId: row.stripe_customer_id ?? null,
    stripeSubscriptionId: row.stripe_subscription_id ?? null
  };
}

function toDb(userId, data = {}) {
  const db = {
    user_id: userId
  };

  if ("usageCount" in data) db.usage_count = data.usageCount;
  if ("replyUsageCount" in data) db.reply_usage_count = data.replyUsageCount;
  if ("plan" in data) db.plan = data.plan;

  if ("privacyAccepted" in data) db.privacy_accepted = data.privacyAccepted;
  if ("privacyAcceptedAt" in data) db.privacy_accepted_at = data.privacyAcceptedAt;
  if ("ageConfirmed" in data) db.age_confirmed = data.ageConfirmed;
  if ("ageConfirmedAt" in data) db.age_confirmed_at = data.ageConfirmedAt;

  if ("pendingClarify" in data) db.pending_clarify = data.pendingClarify;
  if ("pendingText" in data) db.pending_text = data.pendingText;

  if ("lastInput" in data) db.last_input = data.lastInput;
  if ("lastInputType" in data) db.last_input_type = data.lastInputType;
  if ("lastScenario" in data) db.last_scenario = data.lastScenario;
  if ("lastAdvice" in data) db.last_advice = data.lastAdvice;
  if ("lastRiskLevel" in data) db.last_risk_level = data.lastRiskLevel;

  if ("conversationSummary" in data) db.conversation_summary = data.conversationSummary;
  if ("lastChatContext" in data) db.last_chat_context = data.lastChatContext;

  if ("contactAllowed" in data) db.contact_allowed = data.contactAllowed;
  if ("recommendedAction" in data) db.recommended_action = data.recommendedAction;
  if ("mainRisk" in data) db.main_risk = data.mainRisk;
  if ("paywall" in data) db.paywall = data.paywall;

  if ("stripeCustomerId" in data) {
    db.stripe_customer_id = data.stripeCustomerId;
  }

  if ("stripeSubscriptionId" in data) {
    db.stripe_subscription_id = data.stripeSubscriptionId;
  }

  return db;
}

async function getUser(userId) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("SUPABASE GET USER ERROR:", error.message);
    return createUser();
  }

  if (data) {
    return fromDb(data);
  }

  const newUser = createUser();

  const { error: insertError } = await supabase
    .from("users")
    .insert(toDb(userId, newUser));

  if (insertError) {
    console.error("SUPABASE CREATE USER ERROR:", insertError.message);
  }

  return newUser;
}

async function resetUser(userId) {
  const newUser = createUser();

  const { error } = await supabase
    .from("users")
    .update(toDb(userId, newUser))
    .eq("user_id", userId);

  if (error) {
    console.error("SUPABASE RESET USER ERROR:", error.message);
  }

  return newUser;
}

async function resetConversationOnly(userId) {
  const current = await getUser(userId);

  const updated = {
    ...current,

    pendingClarify: false,
    pendingText: null,

    lastInput: null,
    lastInputType: null,
    lastScenario: null,
    lastAdvice: null,
    lastRiskLevel: 1,

    conversationSummary: null,
    lastChatContext: null,

    contactAllowed: undefined,
    recommendedAction: undefined,
    mainRisk: undefined
  };

  const { error } = await supabase
    .from("users")
    .update(toDb(userId, updated))
    .eq("user_id", userId);

  if (error) {
    console.error("SUPABASE RESET CONVERSATION ERROR:", error.message);
  }

  return updated;
}

async function updateUser(userId, data = {}) {
  const current = await getUser(userId);

  const updated = {
    ...current,
    ...data
  };

  const { error } = await supabase
    .from("users")
    .update(toDb(userId, updated))
    .eq("user_id", userId);

  if (error) {
    console.error("SUPABASE UPDATE USER ERROR:", error.message);
  }

  return updated;
}

async function updateUserByStripeSubscription(subscriptionId, data = {}) {
  if (!subscriptionId) return null;

  const { data: row, error: findError } = await supabase
    .from("users")
    .select("*")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (findError) {
    console.error("SUPABASE FIND BY SUBSCRIPTION ERROR:", findError.message);
    return null;
  }

  if (!row) {
    console.error("SUPABASE NO USER FOR SUBSCRIPTION:", subscriptionId);
    return null;
  }

  const user = fromDb(row);

  const updated = {
    ...user,
    ...data
  };

  const { error: updateError } = await supabase
    .from("users")
    .update(toDb(row.user_id, updated))
    .eq("user_id", row.user_id);

  if (updateError) {
    console.error("SUPABASE UPDATE BY SUBSCRIPTION ERROR:", updateError.message);
    return null;
  }

  return updated;
}

async function incrementReplyUsage(userId) {
  const user = await getUser(userId);

  const updated = {
    ...user,
    usageCount: user.usageCount + 1,
    replyUsageCount: user.replyUsageCount + 1
  };

  const { error } = await supabase
    .from("users")
    .update(toDb(userId, updated))
    .eq("user_id", userId);

  if (error) {
    console.error("SUPABASE INCREMENT ERROR:", error.message);
  }

  return updated;
}

module.exports = {
  getUser,
  resetUser,
  resetConversationOnly,
  updateUser,
  updateUserByStripeSubscription,
  incrementReplyUsage
};
