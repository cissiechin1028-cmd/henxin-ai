const axios = require("axios");
const { aiUsageProperties } = require("../tracking/cost");
const { relationshipReportSystemPrompt } = require("../prompts/relationshipReport");
const { relationshipReportSchema } = require("../schemas/outputs");
const { assertLocale } = require("./resultNormalizers");

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

function normalizeReport(raw, locale) {
  const trend = ["rising", "stable", "falling", "unclear"].includes(raw?.trend)
    ? raw.trend : "unclear";
  const content = {
    relationshipChange: String(raw?.relationshipChange || "").trim().slice(0, 1200),
    importantEvents: Array.isArray(raw?.importantEvents)
      ? raw.importantEvents.slice(0, 6).map((item) => String(item).trim().slice(0, 180)).filter(Boolean)
      : [],
    relationshipStage: String(raw?.relationshipStage || "").trim().slice(0, 240),
    positiveSignals: Array.isArray(raw?.positiveSignals) ? raw.positiveSignals.slice(0, 3).map(String).filter(Boolean) : [],
    recurringPatterns: Array.isArray(raw?.recurringPatterns) ? raw.recurringPatterns.slice(0, 3).map(String).filter(Boolean) : [],
    principalRisks: Array.isArray(raw?.principalRisks) ? raw.principalRisks.slice(0, 3).map(String).filter(Boolean) : [],
    growth: String(raw?.growth || "").trim().slice(0, 800),
    aiSummary: String(raw?.aiSummary || "").trim().slice(0, 1600),
    nextSuggestion: raw?.nextSuggestion ? String(raw.nextSuggestion).trim().slice(0, 800) : null,
    signalToObserve: String(raw?.signalToObserve || "").trim().slice(0, 500),
    trend,
  };
  if (!content.relationshipChange || !content.relationshipStage || !content.growth || !content.aiSummary || !content.signalToObserve) {
    throw new Error("AI_INVALID_RESULT");
  }
  assertLocale([
    content.relationshipChange, ...content.importantEvents, content.relationshipStage,
    ...content.positiveSignals, ...content.recurringPatterns, ...content.principalRisks,
    content.growth, content.aiSummary, content.nextSuggestion, content.signalToObserve,
  ], locale);
  return content;
}

function reportTask(locale, { periodType, periodStart, periodEnd, analyses, events }) {
  const focus = {
    ja: periodType === "weekly" ? "直近一週間の小さな変化と、次の一週間に実行できる一歩を重視してください。" : periodType === "monthly" ? "一か月の重要な出来事と、関係の流れや段階の変化を重視してください。" : "一年を通した転機、関係の成長過程、現在地を長期的な視点で振り返ってください。",
    "zh-TW": periodType === "weekly" ? "著重最近一週的細微變化，以及下週能實際做到的一小步。" : periodType === "monthly" ? "著重這個月的重要事件、關係走向與階段變化。" : "以長期視角回顧這一年的轉折、關係成長與目前的位置。",
    en: periodType === "weekly" ? "Focus on small changes this week and one realistic step for the week ahead." : periodType === "monthly" ? "Focus on meaningful events this month and changes in the direction or stage of the relationship." : "Take a long-term view of turning points, growth, and where the relationship stands now.",
  };
  const source = `period=${periodType} ${periodStart}..${periodEnd}\nanalyses=${JSON.stringify(analyses)}\nevents=${JSON.stringify(events)}`;
  if (locale === "zh-TW") return `請為這段期間製作一份自然、克制、適合台灣使用者閱讀的感情紀錄報告。${focus[locale]}\n\n來源資料：\n${source}\n\n欄位要求：relationshipChange 說明期初到期末的變化，不只是列事件；importantEvents 最多6件且忠於日期與內容；relationshipStage 以不武斷的短句描述現況；positiveSignals 最多3個且必須有資料依據；recurringPatterns 只放重複出現的模式，若僅一次就留空；principalRisks 最多3個，不誇大；growth 說明關係或溝通上的成長，資料不足要直說；aiSummary 整合出新的洞察，不重複前文；nextSuggestion 提供1至2個溫和且可執行的下一步，不操控或催促對方；signalToObserve 提供一個接下來可觀察的具體訊號；trend 只能是 rising、stable、falling、unclear，資料不足用 unclear。各欄不要重複，依指定 JSON 結構回答。`;
  if (locale === "en") return `Create a clear, measured relationship record for this period in natural contemporary English. ${focus.en}\n\nSource data:\n${source}\n\nField guidance: relationshipChange explains the change from the start to the end of the period rather than listing events; importantEvents includes up to six events and preserves dates and facts; relationshipStage describes the current position briefly without overclaiming; positiveSignals contains up to three evidence-based signals; recurringPatterns includes only patterns seen more than once and stays empty for one-off events; principalRisks contains up to three realistic concerns without exaggeration; growth describes development in the relationship or communication and states when evidence is limited; aiSummary adds an integrated insight without repeating earlier fields; nextSuggestion gives one or two calm, practical next steps without manipulation or pressure; signalToObserve names one concrete sign to watch next; trend must be rising, stable, falling, or unclear, using unclear when evidence is insufficient. Keep fields distinct and return the required JSON structure.`;
  return `対象期間: ${periodType} ${periodStart}〜${periodEnd}\n${focus.ja}\n\n分析結論: ${JSON.stringify(analyses)}\n重要な出来事: ${JSON.stringify(events)}\n\nrelationshipChangeは期間の始めから終わりまでの変化、importantEventsは入力にある重要な出来事を最大6件、relationshipStageは断定を避けた現在地、positiveSignalsは根拠のある兆候を最大3件、recurringPatternsは複数回確認できるものだけ、principalRisksは誇張しない現実的な注意点を最大3件、growthは関係やコミュニケーションの成長、aiSummaryは重複しない統合的な洞察、nextSuggestionは相手を操作したり返信を迫ったりしない具体的な提案を1〜2件、signalToObserveは次に観察する具体的な兆候を1件にしてください。trendはrising、stable、falling、unclearのいずれかで、材料不足ならunclearです。各欄を重複させず、指定されたJSON構造で返してください。`;
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
  const userPrompt = reportTask(locale, { periodType, periodStart, periodEnd, analyses: safeAnalyses, events: safeEvents });
  const response = await axios.post("https://api.openai.com/v1/chat/completions", {
    model: process.env.OPENAI_TEXT_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini",
    messages: [
      { role: "system", content: relationshipReportSystemPrompt(locale) },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.25,
    max_tokens: periodType === "yearly" ? 1400 : 1000,
    response_format: { type: "json_schema", json_schema: relationshipReportSchema },
  }, {
    timeout: 60000,
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
  });
  return {
    content: normalizeReport(parseJson(response.data?.choices?.[0]?.message?.content), locale),
    model: response.data?.model || process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini",
    usage: aiUsageProperties(
      response,
      response.data?.model || process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini",
      `relationship_report_${periodType}`
    ),
  };
}

module.exports = { generateRelationshipReport, periodBounds };
