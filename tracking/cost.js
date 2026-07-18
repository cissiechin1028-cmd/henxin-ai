function numberEnv(name) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function aiUsageProperties(response, model, feature) {
  const usage = response?.data?.usage || {};
  const promptTokens = Number(usage.prompt_tokens || 0);
  const cachedTokens = Number(usage.prompt_tokens_details?.cached_tokens || 0);
  const completionTokens = Number(usage.completion_tokens || 0);
  const inputRate = numberEnv("OPENAI_INPUT_USD_PER_1M_TOKENS");
  const cachedRate = numberEnv("OPENAI_CACHED_INPUT_USD_PER_1M_TOKENS");
  const outputRate = numberEnv("OPENAI_OUTPUT_USD_PER_1M_TOKENS");
  const configured = inputRate !== null && outputRate !== null;
  const costUsd = configured
    ? (((promptTokens - cachedTokens) * inputRate) + (cachedTokens * (cachedRate ?? inputRate)) + (completionTokens * outputRate)) / 1_000_000
    : 0;
  return {
    feature, model, prompt_tokens: promptTokens, cached_tokens: cachedTokens,
    completion_tokens: completionTokens, total_tokens: Number(usage.total_tokens || promptTokens + completionTokens),
    cost_micros: Math.round(costUsd * 1_000_000), cost_status: configured ? "calculated" : "unconfigured"
  };
}

module.exports = { aiUsageProperties };
