const axios = require("axios");
const { aiUsageProperties } = require("../tracking/cost");
const { replyProposalPrompt } = require("../prompts/replyProposal");
const { chatAnalysisPrompt } = require("../prompts/chatAnalysis");
const { relationshipEventPrompt } = require("../prompts/relationshipEvent");
const { replyProposalSchema, chatAnalysisSchema, relationshipEventSchema } = require("../schemas/outputs");
const { normalizeReply, normalizeAnalysis, normalizeTimelineEvent } = require("./resultNormalizers");

function parseJson(text = "") {
  const cleaned = String(text).replace(/```json|```/g, "").trim();
  try { return JSON.parse(cleaned); } catch { throw new Error("AI_INVALID_JSON"); }
}

async function callStructured({ prompt, task, imageDataUrl, schema, maxTokens, temperature }) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await axios.post("https://api.openai.com/v1/chat/completions", {
        model: process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini",
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: [
            { type: "text", text: task },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ] },
        ],
        temperature: attempt === 0 ? temperature : 0,
        max_tokens: maxTokens,
        response_format: { type: "json_schema", json_schema: schema },
      }, {
        timeout: 60000,
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      });
      return { raw: parseJson(response.data?.choices?.[0]?.message?.content), response };
    } catch (error) {
      lastError = error;
      const status = Number(error?.response?.status || 0);
      if (status === 401 || status === 403 || status === 429) break;
    }
  }
  throw lastError || new Error("AI_FAILED");
}

async function analyzeForWeb({ imageBuffer, mimeType, mode, locale = "ja", context = {} }) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_NOT_CONFIGURED");
  const startedAt = Date.now();
  const model = process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";
  const imageDataUrl = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

  if (mode === "reply") {
    const [main, eventAttempt] = await Promise.all([
      callStructured({
        prompt: replyProposalPrompt(locale, context),
        task: "Create reply proposals from this screenshot. Use only visible evidence and verified context.",
        imageDataUrl, schema: replyProposalSchema, maxTokens: 900, temperature: 0.3,
      }),
      callStructured({
        prompt: relationshipEventPrompt(locale),
        task: "Independently determine whether this screenshot contains one clearly evidenced relationship-significant event.",
        imageDataUrl, schema: relationshipEventSchema, maxTokens: 500, temperature: 0,
      }).catch((error) => ({ error })),
    ]);
    const result = normalizeReply(main.raw, locale);
    const auxiliaryUsages = [];
    if (eventAttempt.error) {
      console.error("RELATIONSHIP EVENT EXTRACTION FAILED", String(eventAttempt.error.message || eventAttempt.error));
      result.timelineEvent = { shouldRecord: false };
    } else {
      result.timelineEvent = normalizeTimelineEvent(eventAttempt.raw);
      auxiliaryUsages.push(aiUsageProperties(eventAttempt.response, eventAttempt.response.data?.model || model, "relationship_event_extraction"));
    }
    return {
      result, model: main.response.data?.model || model,
      processingMs: Date.now() - startedAt,
      usage: aiUsageProperties(main.response, main.response.data?.model || model, "reply_idea"),
      auxiliaryUsages,
    };
  }

  // The relationship-event extraction is independent of the analysis result.
  // Run both calls together so a mobile request does not wait for two complete
  // model round trips and get reported as a network failure by the browser.
  const [main, eventAttempt] = await Promise.all([
    callStructured({
      prompt: chatAnalysisPrompt(locale, context),
      task: "Analyse this exchange. Keep facts, interpretations, and actions distinct.",
      imageDataUrl, schema: chatAnalysisSchema, maxTokens: 1500, temperature: 0.2,
    }),
    callStructured({
      prompt: relationshipEventPrompt(locale),
      task: "Independently determine whether this screenshot contains one clearly evidenced relationship-significant event.",
      imageDataUrl, schema: relationshipEventSchema, maxTokens: 500, temperature: 0,
    }).catch((error) => ({ error })),
  ]);
  const result = normalizeAnalysis(main.raw);
  const auxiliaryUsages = [];
  if (eventAttempt.error) {
    console.error("RELATIONSHIP EVENT EXTRACTION FAILED", String(eventAttempt.error.message || eventAttempt.error));
    result.timelineEvent = { shouldRecord: false };
  } else {
    result.timelineEvent = normalizeTimelineEvent(eventAttempt.raw);
    auxiliaryUsages.push(aiUsageProperties(eventAttempt.response, eventAttempt.response.data?.model || model, "relationship_event_extraction"));
  }
  return {
    result, model: main.response.data?.model || model,
    processingMs: Date.now() - startedAt,
    usage: aiUsageProperties(main.response, main.response.data?.model || model, "chat_analysis"),
    auxiliaryUsages,
  };
}

module.exports = { analyzeForWeb };
