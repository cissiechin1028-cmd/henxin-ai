const axios = require("axios");
const { aiUsageProperties } = require("../tracking/cost");
const { relationshipReportSystemPrompt } = require("../prompts/relationshipReport");
const { relationshipReportSchema } = require("../schemas/outputs");

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
  return content;
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
  const periodFocus = periodType === "weekly"
    ? "直近一週間の小さな変化と、次の一週間に実行できる一歩を重視してください。"
    : periodType === "monthly"
      ? "一か月の重要な出来事と、関係の流れや段階の変化を重視してください。"
      : "一年を通した転機、関係の成長過程、現在地を長期的な視点で振り返ってください。";
  const userPrompt = `対象期間: ${periodType} ${periodStart}〜${periodEnd}
${periodFocus}

分析結論: ${JSON.stringify(safeAnalyses)}
重要な出来事: ${JSON.stringify(safeEvents)}

フィールドの役割:
- relationshipChange: 期間の始めから終わりまでに見られる変化。出来事の列挙はしない。
- importantEvents: 関係の理解に影響した出来事だけを最大6件。入力にある日付と内容を忠実に使う。
- relationshipStage: 現在地を、断定を避けた短い表現で示す。
- positiveSignals: 入力に裏付けられた前向きな兆候だけを最大3件。
- recurringPatterns: 複数回確認できる反復パターンだけを最大3件。単発なら空配列。
- principalRisks: 現実的に注意すべき点だけを最大3件。価値を演出するために誇張しない。
- growth: ふたりの関係やコミュニケーションに見られる成長・発展。材料不足なら不足を明記する。
- aiSummary: 変化、出来事、現在地を統合した新しい洞察。前の欄の文章を繰り返さない。
- nextSuggestion: 次の期間に実行できる具体的で穏やかな提案を1〜2件。相手を操作したり返信を迫ったりしない。
- signalToObserve: 次に関係の変化を判断するために観察すべき具体的な兆候を1件。
- trend: rising、stable、falling、unclearのいずれか。材料不足ならunclear。

各欄を重複させずに、指定された構造で返してください。`;
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
    content: normalizeReport(parseJson(response.data?.choices?.[0]?.message?.content)),
    model: response.data?.model || process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini",
    usage: aiUsageProperties(
      response,
      response.data?.model || process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini",
      `relationship_report_${periodType}`
    ),
  };
}

module.exports = { generateRelationshipReport, periodBounds };
