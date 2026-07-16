const axios = require("axios");

function parseJson(text = "") {
  const cleaned = String(text).replace(/```json|```/g, "").trim();
  try { return JSON.parse(cleaned); } catch { throw new Error("AI_INVALID_JSON"); }
}

function periodBounds(periodType, anchorValue) {
  const anchor = anchorValue ? new Date(`${anchorValue}T00:00:00Z`) : new Date();
  if (Number.isNaN(anchor.getTime())) throw new Error("INVALID_REPORT_DATE");
  let start;
  let end;
  if (periodType === "weekly") {
    const weekday = anchor.getUTCDay() || 7;
    start = new Date(anchor); start.setUTCDate(anchor.getUTCDate() - weekday + 1);
    end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
  } else if (periodType === "monthly") {
    start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
  } else if (periodType === "yearly") {
    start = new Date(Date.UTC(anchor.getUTCFullYear(), 0, 1));
    end = new Date(Date.UTC(anchor.getUTCFullYear(), 11, 31));
  } else {
    throw new Error("INVALID_REPORT_PERIOD");
  }
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function normalizeReport(raw) {
  const trend = ["rising", "stable", "falling", "unclear"].includes(raw?.trend)
    ? raw.trend : "unclear";
  const content = {
    relationshipChange: String(raw?.relationshipChange || "").trim().slice(0, 1200),
    importantEvents: Array.isArray(raw?.importantEvents)
      ? raw.importantEvents.slice(0, 6).map((item) => String(item).trim().slice(0, 180)).filter(Boolean)
      : [],
    relationshipStage: String(raw?.relationshipStage || "").trim().slice(0, 240),
    aiSummary: String(raw?.aiSummary || "").trim().slice(0, 1600),
    nextSuggestion: raw?.nextSuggestion ? String(raw.nextSuggestion).trim().slice(0, 800) : null,
    trend,
  };
  if (!content.relationshipChange || !content.relationshipStage || !content.aiSummary) {
    throw new Error("AI_INVALID_RESULT");
  }
  return content;
}

function languageInstruction(locale) {
  if (locale === "zh-TW") return "請使用台灣繁體中文，語氣自然、溫和且清楚。";
  if (locale === "en") return "Write in clear, warm, natural English.";
  return "自然でやさしく、読みやすい日本語で書いてください。";
}

async function generateRelationshipReport({ periodType, locale, periodStart, periodEnd, analyses, events }) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_NOT_CONFIGURED");
  const safeAnalyses = analyses.map((item) => ({
    date: String(item.completed_at || item.created_at).slice(0, 10),
    summary: String(item.result?.summary || "").slice(0, 600),
    psychology: String(item.result?.currentPsychology || "").slice(0, 600),
    trend: item.result?.relationshipTrend || "stable",
    actions: Array.isArray(item.result?.actions) ? item.result.actions.slice(0, 3).map(String) : [],
  }));
  const safeEvents = events.map((item) => ({
    date: item.event_date,
    title: String(item.title || "").slice(0, 120),
    note: String(item.note || "").slice(0, 300),
    source: item.source,
  }));
  const prompt = `あなたは恋愛関係の成長を振り返るAIです。${languageInstruction(locale)}
期間: ${periodType} ${periodStart}〜${periodEnd}
以下は会話本文や画像ではなく、既存の分析結論と重要な出来事だけです。記録にない事実を作らず、相手の心理を断定せず、利用回数には触れないでください。個人情報や会話本文を出力しないでください。
分析結論: ${JSON.stringify(safeAnalyses)}
重要な出来事: ${JSON.stringify(safeEvents)}
JSONのみを返してください: {"relationshipChange":"期間中の関係変化","importantEvents":["重要な出来事"],"relationshipStage":"現在の関係段階","aiSummary":"期間全体のAIまとめ","nextSuggestion":"次の期間への具体的で穏やかな提案","trend":"rising|stable|falling|unclear"}`;
  const response = await axios.post("https://api.openai.com/v1/chat/completions", {
    model: process.env.OPENAI_TEXT_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.25,
    max_tokens: periodType === "yearly" ? 1400 : 1000,
    response_format: { type: "json_object" },
  }, {
    timeout: 60000,
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
  });
  return {
    content: normalizeReport(parseJson(response.data?.choices?.[0]?.message?.content)),
    model: response.data?.model || process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini",
  };
}

module.exports = { generateRelationshipReport, periodBounds };
