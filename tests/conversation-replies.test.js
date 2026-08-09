const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");

const validReply = {
  conversationTemperature: 66,
  currentState: "相手は会話を続ける余地を残しています。",
  options: [
    { strategy: "option_1", text: "わかった、無理しないでね。", reason: "相手を気遣いながら自然に返します。" },
    { strategy: "option_2", text: "教えてくれてありがとう。落ち着いたら話そう。", reason: "安心感を添えて次につなげます。" },
    { strategy: "option_3", text: "了解だよ。また話せるときに連絡してね。", reason: "負担をかけずに距離を保ちます。" },
  ],
  timelineEvent: { shouldRecord: false, eventType: "custom", title: "", aiSummary: "", eventDate: null, evidenceStrength: "insufficient" },
};

test("conversation reply uses GPT-5 compatible parameters and returns three proposals", async () => {
  const previousModel = process.env.OPENAI_VISION_MODEL;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_VISION_MODEL = "gpt-5-mini";
  process.env.OPENAI_API_KEY = "test-key";
  let requestBody;
  const axiosStub = { post: async (_url, body) => {
    requestBody = body;
    return {
      data: { model: "gpt-5-mini", choices: [{ message: { content: JSON.stringify(validReply) } }], usage: { prompt_tokens: 120, completion_tokens: 80 } },
      headers: {},
    };
  } };
  const previousLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "axios") return axiosStub;
    return previousLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[require.resolve("../services/webAnalysis")];
    const { analyzeConversationForWeb } = require("../services/webAnalysis");
    const output = await analyzeConversationForWeb({
      messages: [{ sender: "partner", text: "今ちょっと忙しい" }, { sender: "self", text: "わかった" }],
      partnerName: "レン",
      locale: "ja",
      context: {},
    });
    assert.equal(requestBody.model, "gpt-5-mini");
    assert.equal(requestBody.temperature, undefined);
    assert.equal(requestBody.max_tokens, undefined);
    assert.ok(requestBody.max_completion_tokens >= 2200);
    assert.equal(output.result.kind, "reply");
    assert.equal(output.result.alternatives.length, 2);
    assert.equal(output.result.recommendedReply, validReply.options[0].text);
  } finally {
    Module._load = previousLoad;
    if (previousModel === undefined) delete process.env.OPENAI_VISION_MODEL; else process.env.OPENAI_VISION_MODEL = previousModel;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
  }
});
