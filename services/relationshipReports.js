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
  if (locale === "zh-TW") return "請使用台灣繁體中文與台灣常用詞，語氣自然、溫和且清楚；可以真誠直接，但不要催促對方表態，也不要使用中國大陸用語或翻譯腔。";
  if (locale === "en") return "Write in clear, warm, natural English. Respect direct communication, consent and personal boundaries; do not overread brevity or reply delays.";
  return "自然でやさしく、読みやすい日本語で書いてください。敬語とため口の距離感や婉曲表現を尊重し、短文や返信間隔だけで関係を決めつけないでください。";
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
  const systemPrompt = `あなたは恋愛関係の記録を丁寧に振り返るAIです。${languageInstruction(locale)}
与えられるのは会話本文ではなく、既存の分析結論と利用者が保存した出来事です。記録にない事実を作らず、相手の心理や関係段階を事実として断定しないでください。個人情報、会話本文、AI利用回数、分析回数、返信回数には触れないでください。
各出力欄の役割を分け、同じ出来事や結論を複数の欄で繰り返さないでください。記録が少ない場合は不足を率直に示し、無理に変化を作らないでください。出力は指定されたJSONだけにしてください。`;
  const userPrompt = `対象期間: ${periodType} ${periodStart}〜${periodEnd}
${periodFocus}

分析結論: ${JSON.stringify(safeAnalyses)}
重要な出来事: ${JSON.stringify(safeEvents)}

フィールドの役割:
- relationshipChange: 期間の始めから終わりまでに見られる変化。出来事の列挙はしない。
- importantEvents: 関係の理解に影響した出来事だけを最大6件。入力にある日付と内容を忠実に使う。
- relationshipStage: 現在地を、断定を避けた短い表現で示す。
- aiSummary: 変化、出来事、現在地を統合した新しい洞察。前の欄の文章を繰り返さない。
- nextSuggestion: 次の期間に実行できる具体的で穏やかな提案を1〜2件。相手を操作したり返信を迫ったりしない。
- trend: rising、stable、falling、unclearのいずれか。材料不足ならunclear。

次の形式のみを返してください: {"relationshipChange":"","importantEvents":[""],"relationshipStage":"","aiSummary":"","nextSuggestion":"","trend":"rising|stable|falling|unclear"}`;
  const response = await axios.post("https://api.openai.com/v1/chat/completions", {
    model: process.env.OPENAI_TEXT_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
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
