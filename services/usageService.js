const { AI_USAGE_CONFIG } = require("../config/aiUsage");

function currentBillingPeriod(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function createUsageService({ supabase }) {
  async function check(userId, feature) {
    const units = AI_USAGE_CONFIG.featureUnits[feature];
    if (!Number.isFinite(units) || units <= 0) throw new Error("INVALID_USAGE_FEATURE");

    const { data: profile, error: profileError } = await supabase
      .from("profiles").select("plan").eq("id", userId).single();
    if (profileError) throw new Error("USAGE_PROFILE_READ_FAILED");
    if (profile?.plan !== "pro") return { allowed: true, plan: "free", units: 0 };

    const billingPeriod = currentBillingPeriod();
    const budgetUnits = AI_USAGE_CONFIG.proBudgetUnits;
    const { data: existing, error: readError } = await supabase
      .from("ai_usage_periods")
      .select("used_units,budget_units")
      .eq("user_id", userId)
      .eq("billing_period", billingPeriod)
      .maybeSingle();
    if (readError) throw new Error("USAGE_READ_FAILED");

    const usedUnits = Number(existing?.used_units || 0);
    if (!existing) {
      const { error: insertError } = await supabase.from("ai_usage_periods").insert({
        user_id: userId,
        billing_period: billingPeriod,
        used_units: 0,
        budget_units: budgetUnits,
      });
      if (insertError && insertError.code !== "23505") throw new Error("USAGE_CREATE_FAILED");
    } else if (Number(existing.budget_units) !== budgetUnits) {
      const { error: updateError } = await supabase.from("ai_usage_periods")
        .update({ budget_units: budgetUnits, updated_at: new Date().toISOString() })
        .eq("user_id", userId).eq("billing_period", billingPeriod);
      if (updateError) throw new Error("USAGE_BUDGET_UPDATE_FAILED");
    }

    return {
      allowed: usedUnits + units <= budgetUnits,
      plan: "pro",
      userId,
      billingPeriod,
      units,
      budgetUnits,
    };
  }

  async function recordSuccess(usage) {
    if (!usage || usage.plan !== "pro" || !usage.units) return;
    const { error } = await supabase.rpc("record_ai_usage_success", {
      target_user_id: usage.userId,
      target_billing_period: usage.billingPeriod,
      consumed_units: usage.units,
      default_budget_units: usage.budgetUnits,
    });
    if (error) throw new Error("USAGE_RECORD_FAILED");
  }

  return { check, recordSuccess };
}

module.exports = { createUsageService, currentBillingPeriod };
