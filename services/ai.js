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
  const { prompt, systemPrompt } = getPromptSet({ input, userState });
  console.log("ENTRY MODE:", userState?.context?.entryMode);
  console.log("SYSTEM PROMPT HEAD:", systemPrompt.slice(0, 80));
  console.log("USER PROMPT HEAD:", prompt.slice(0, 120));

  try {
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

    return formatFreeReply(aiResponse);
  } catch (err) {
    console.error("OPENAI ERROR:", err.response?.data || err.message);

    return `「無理に返さなくて大丈夫。落ち着いたらまた話そう」

今は理由を聞くより、相手が戻りやすい余白を残す方がいいです。`;
  }
}

module.exports = { generateAIResponse };
