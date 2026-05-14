const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

function createUser() {
  return {
    usageCount: 0,
    replyUsageCount: 0,
    plan: "free",

    pendingClarify: false,
    pendingText: null,

    lastInput: null,
    lastInputType: null,
    lastScenario: null,
    lastAdvice: null,
    lastRiskLevel: 1,

    conversationSummary: null
  };
}

function fromDb(row = {}) {
  return {
    usageCount: row.usage_count ?? 0,
    replyUsageCount: row.reply_usage_count ?? 0,
    plan: row.plan || "free",

    pendingClarify: row.pending_clarify ?? false,
    pendingText: row.pending_text ?? null,

    lastInput: row.last_input ?? null,
    lastInputType: row.last_input_type ?? null,
    lastScenario: row.last_scenario ?? null,
    lastAdvice: row.last_advice ?? null,
    lastRiskLevel: row.last_risk_level ?? 1,

    conversationSummary: row.conversation_summary ?? null,

    contactAllowed: row.contact_allowed ?? undefined,
    recommendedAction: row.recommended_action ?? undefined,
    mainRisk: row.main_risk ?? undefined,
    paywall: row.paywall ?? false
  };
}

function toDb(userId, data = {}) {
  const db = {
    user_id: userId
  };

  if ("usageCount" in data) db.usage_count = data.usageCount;
  if ("replyUsageCount" in data) db.reply_usage_count = data.replyUsageCount;
  if ("plan" in data) db.plan = data.plan;

  if ("pendingClarify" in data) db.pending_clarify = data.pendingClarify;
  if ("pendingText" in data) db.pending_text = data.pendingText;

  if ("lastInput" in data) db.last_input = data.lastInput;
  if ("lastInputType" in data) db.last_input_type = data.lastInputType;
  if ("lastScenario" in data) db.last_scenario = data.lastScenario;
  if ("lastAdvice" in data) db.last_advice = data.lastAdvice;
  if ("lastRiskLevel" in data) db.last_risk_level = data.lastRiskLevel;

  if ("conversationSummary" in data) db.conversation_summary = data.conversationSummary;

  if ("contactAllowed" in data) db.contact_allowed = data.contactAllowed;
  if ("recommendedAction" in data) db.recommended_action = data.recommendedAction;
  if ("mainRisk" in data) db.main_risk = data.mainRisk;
  if ("paywall" in data) db.paywall = data.paywall;

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
  updateUser,
  incrementReplyUsage
};
