const axios = require("axios");
const { formatFreeReply } = require("./promptBuilder");
const { buildReplyPrompt, replySystemPrompt } = require("./prompts/replyPrompt");
const { buildMindPrompt, mindSystemPrompt } = require("./prompts/mindPrompt");
const { buildConsultPrompt, consultSystemPrompt } = require("./prompts/consultPrompt");

function getPromptSet({ input, userState }) {
  const entryMode = userState?.context?.entryMode || "reply";

  if (entryMode === "mind") {
    return {
      prompt: buildMindPrompt({ input, userState }),
      systemPrompt: mindSystemPrompt
    };
  }

  if (entryMode === "consult") {
    return {
      prompt: buildConsultPrompt({ input, userState }),
      systemPrompt: consultSystemPrompt
    };
  }

  return {
    prompt: buildReplyPrompt({ input, userState }),
    systemPrompt: replySystemPrompt
  };
}

async function generateAIResponse({ input, userState }) {
  const startTime = Date.now();
  const entryMode = userState?.context?.entryMode || "reply";

  console.log("AI START", {
    entryMode,
    inputType: userState?.inputType,
    scenario: userState?.scenario,
    inputLength: String(input || "").length
  });

  const { prompt, systemPrompt } = getPromptSet({ input, userState });

  try {
    const openaiStart = Date.now();

    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.65,
        max_tokens: 450
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const aiResponse = res.data.choices[0].message.content.trim();

    console.log("AI DONE", {
      entryMode,
      openaiMs: Date.now() - openaiStart,
      totalMs: Date.now() - startTime,
      outputLength: aiResponse.length
    });

    return formatFreeReply(aiResponse);
  } catch (err) {
    console.error("OPENAI ERROR:", err.response?.data || err.message);
    console.error("AI FAILED", {
      entryMode,
      totalMs: Date.now() - startTime
    });

    return `「無理に返さなくて大丈夫。落ち着いたらまた話そう」

今は理由を聞くより、相手が戻りやすい余白を残す方がいいです。`;
  }
}

module.exports = { generateAIResponse };
