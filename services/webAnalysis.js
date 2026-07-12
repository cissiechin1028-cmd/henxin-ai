const axios = require("axios");

function parseJson(text = "") {
  const cleaned = String(text).replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("AI_INVALID_JSON");
  }
}

function clampScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function normalizeReply(raw) {
  if (!raw || typeof raw.recommendedReply !== "string") throw new Error("AI_INVALID_RESULT");
  return {
    kind: "reply",
    naturalness: clampScore(raw.naturalness),
    recommendedReply: raw.recommendedReply.trim(),
    alternatives: Array.isArray(raw.alternatives)
      ? raw.alternatives.slice(0, 3).map((item) => ({
          tone: String(item?.tone || "別案").slice(0, 20),
          text: String(item?.text || "").trim()
        })).filter((item) => item.text)
      : [],
    reason: String(raw.reason || "").trim(),
    caution: raw.caution ? String(raw.caution).trim() : undefined
  };
}

function normalizeAnalysis(raw) {
  const trend = ["rising", "stable", "falling"].includes(raw?.relationshipTrend)
    ? raw.relationshipTrend
    : "stable";
  return {
    kind: "analysis",
    affection: clampScore(raw?.affection),
    intentConsistency: clampScore(raw?.intentConsistency),
    relationshipTrend: trend,
    progressRisk: clampScore(raw?.progressRisk),
    summary: String(raw?.summary || "").trim(),
    evidence: Array.isArray(raw?.evidence) ? raw.evidence.slice(0, 4).map(String) : [],
    actions: Array.isArray(raw?.actions) ? raw.actions.slice(0, 3).map(String) : []
  };
}

function systemPrompt(mode) {
  const common = `あなたは日本語の恋愛チャット支援AIです。LINE画面の左右を慎重に読み、見えない内容を捏造しないでください。相手の心理を事実として断定せず、観察できる会話の特徴と推測を分けてください。個人情報は結果に転記しないでください。JSON以外を返さないでください。`;
  if (mode === "reply") {
    return `${common}\n次に送る自然な返信を提案してください。次の形式のみを返してください：{"naturalness":0,"recommendedReply":"","alternatives":[{"tone":"","text":""}],"reason":"","caution":""}`;
  }
  return `${common}\n会話全体の傾向を分析してください。数値は0〜100です。次の形式のみを返してください：{"affection":0,"intentConsistency":0,"relationshipTrend":"rising|stable|falling","progressRisk":0,"summary":"","evidence":[""],"actions":[""]}`;
}

async function analyzeForWeb({ imageBuffer, mimeType, mode }) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_NOT_CONFIGURED");
  const startedAt = Date.now();
  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt(mode) },
        {
          role: "user",
          content: [
            { type: "text", text: mode === "reply" ? "この会話に対する次の返信を作ってください。" : "この会話の関係性を分析してください。" },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBuffer.toString("base64")}` } }
          ]
        }
      ],
      temperature: 0.35,
      max_tokens: mode === "reply" ? 700 : 1000,
      response_format: { type: "json_object" }
    },
    {
      timeout: 60000,
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }
    }
  );
  const raw = parseJson(response.data?.choices?.[0]?.message?.content);
  return {
    result: mode === "reply" ? normalizeReply(raw) : normalizeAnalysis(raw),
    model: response.data?.model || process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini",
    processingMs: Date.now() - startedAt
  };
}

module.exports = { analyzeForWeb };

