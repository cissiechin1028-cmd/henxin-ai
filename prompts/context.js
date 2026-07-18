function cleanText(value, max = 600) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function buildContext(context = {}) {
  const safe = {
    relationshipStage: cleanText(context.relationshipStage, 120),
    userGoal: cleanText(context.userGoal, 240),
    userStyle: cleanText(context.userStyle, 240),
    conversationSummary: cleanText(context.conversationSummary),
    lastChatContext: cleanText(context.lastChatContext),
  };
  const available = Object.entries(safe).filter(([, value]) => value);
  const recentEvents = Array.isArray(context.recentEvents)
    ? context.recentEvents.slice(0, 5).map((item) => ({
        date: cleanText(item?.date, 10), title: cleanText(item?.title, 120), source: cleanText(item?.source, 16)
      })).filter((item) => item.date && item.title)
    : [];
  const priorAnalysis = cleanText(context.priorAnalysis, 600);
  if (!available.length && !recentEvents.length && !priorAnalysis) {
    return "No relationship context was provided. Use only the screenshot and mark uncertainty where needed.";
  }
  const sections = [];
  if (available.length) sections.push(`User-provided context:\n${available.map(([key, value]) => `- ${key}: ${value}`).join("\n")}`);
  if (recentEvents.length) sections.push(`Events saved within this same relationship:\n${recentEvents.map((item) => `- ${item.date}: ${item.title} (${item.source})`).join("\n")}`);
  if (priorAnalysis) sections.push(`Prior AI interpretation from this same relationship (not verified fact):\n- ${priorAnalysis}`);
  return `${sections.join("\n")}\nCurrent screenshot evidence takes priority. Never convert a prior AI interpretation into fact.`;
}

module.exports = { buildContext };
