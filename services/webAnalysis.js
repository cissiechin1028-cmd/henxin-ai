const axios = require("axios");
const { aiUsageProperties } = require("../tracking/cost");
const { replyProposalPrompt } = require("../prompts/replyProposal");
const { chatAnalysisPrompt } = require("../prompts/chatAnalysis");
const { topicAnalysisPrompt } = require("../prompts/topicAnalysis");
const { replyProposalSchema, chatAnalysisSchema, topicAnalysisSchema, themeReportSchema } = require("../schemas/outputs");
const { assertLocale, normalizeReply, normalizeAnalysis } = require("./resultNormalizers");
const { prepareDeterministicAnalysis } = require("./deterministicFiveDimension");
const { selectAnalysisWindow } = require("./analysisWindow");

function parseJson(text = "") {
  const cleaned = String(text).replace(/```json|```/g, "").trim();
  try { return JSON.parse(cleaned); } catch { throw new Error("AI_INVALID_JSON"); }
}

const webTasks = {
  ja: {
    reply: (name) => `${name || "相手"}との会話記録から返信案を作ってください。OCRは行わず、会話記録と確認済みの文脈だけを使います。VISIBLE TIMEは時刻の根拠、TIME UNKNOWNは返信時間を推測できないことを示します。並び順だけで返信が遅い、関係が冷めたなどと判断しないでください。`,
    topic: (name) => `${name || "相手"}との会話記録を、指定されたテーマに沿って分析してください。OCRは行わず、確認できる発言と文脈だけを根拠にしてください。`,
    screenshotReply: "画面に見える内容と確認済みの文脈だけから、返信案と簡潔なtimelineEventを作ってください。見えない情報を補わないでください。",
    screenshotAnalysis: "このやり取りを分析し、簡潔なtimelineEventも含めてください。確認できる事実、解釈、次の行動を明確に分けてください。",
  },
  "zh-TW": {
    reply: (name) => `請根據與${name || "對方"}的對話紀錄提出回覆建議。不要進行 OCR，只能使用對話紀錄與已確認的背景。VISIBLE TIME 是可用的時間證據；TIME UNKNOWN 代表不能推測該則訊息的回覆時間。不可只憑訊息排列順序判定回覆變慢或關係降溫。`,
    topic: (name) => `請依指定主題分析與${name || "對方"}的對話紀錄。不要進行 OCR，只能根據可確認的訊息與背景判讀。`,
    screenshotReply: "請只根據畫面中可見的內容與已確認背景，提出回覆建議並產生精簡的 timelineEvent；不要補寫看不到的資訊。",
    screenshotAnalysis: "請分析這段互動並包含精簡的 timelineEvent，清楚區分可確認的事實、你的判讀與可採取的行動。",
  },
  en: {
    reply: (name) => `Create reply options from the conversation with ${name || "the other person"}. Do not perform OCR; use only the transcript and verified context. VISIBLE TIME is valid timing evidence, while TIME UNKNOWN means no timing inference is allowed. Never infer slower replies or a cooling relationship from message order alone.`,
    topic: (name) => `Analyze the conversation with ${name || "the other person"} for the selected topic. Do not perform OCR, and base the analysis only on verified messages and context.`,
    screenshotReply: "Use only visible evidence and verified context in this screenshot to create reply options and a compact timelineEvent. Do not fill in anything that is not shown.",
    screenshotAnalysis: "Analyze this exchange and include a compact timelineEvent. Keep verified facts, interpretation, and suggested actions distinct.",
  },
};
const taskFor = (locale) => webTasks[locale] || webTasks.ja;
const topicStrings = (raw) => {
  const output = [];
  const visit = (value, key = "") => {
    if (typeof value === "string" && !["id", "type", "status", "level", "topic_id", "excerpt"].includes(key)) output.push(value);
    else if (Array.isArray(value)) value.forEach((item) => visit(item, key));
    else if (value && typeof value === "object") Object.entries(value).forEach(([childKey, child]) => visit(child, childKey));
  };
  visit(raw);
  return output;
};

function validateTopicDepth(raw, context = {}) {
  if (!raw || !Array.isArray(raw.modules) || !Array.isArray(raw.evidence) || !Array.isArray(raw.missing_evidence)) throw new Error("AI_INVALID_TOPIC_REPORT");
  const meaningful = value => typeof value === "string" && value.replace(/\s/g, "").length >= 10;
  const titled = value => typeof value === "string" && value.replace(/\s/g, "").length >= 4;
  if (!titled(raw.verdict) || !meaningful(raw.summary)) throw new Error("AI_SHALLOW_TOPIC_REPORT");
  const moduleTypes = new Set(raw.modules.map(module => module?.type));
  const required = Array.isArray(context.requiredModules) ? context.requiredModules : [];
  if (required.some(type => !moduleTypes.has(type))) throw new Error("AI_INCOMPLETE_TOPIC_REPORT");
  if (raw.modules.some(module => !titled(module?.title) || !Array.isArray(module?.items) || module.items.length < 1 || module.items.some(item => !meaningful(item)))) throw new Error("AI_SHALLOW_TOPIC_REPORT");
  if (context.readinessStatus === "sufficient") {
    if (raw.evidence.length < 2 || raw.modules.length < Math.max(3, required.length)) throw new Error("AI_SHALLOW_TOPIC_REPORT");
    if (raw.modules.filter(module => required.includes(module.type)).some(module => module.items.length < 2)) throw new Error("AI_SHALLOW_TOPIC_REPORT");
  } else if (raw.missing_evidence.length < 1) throw new Error("AI_MISSING_LIMITATION");
}

const localeRetryInstruction = {
  ja: "RETRY LOCALE REQUIREMENT: Keep TARGET_OUTPUT_LOCALE=ja. Rewrite every analysis field in Japanese. The source transcript language and original names do not change the output locale.",
  "zh-TW": "重試語言要求：維持 TARGET_OUTPUT_LOCALE=zh-TW。所有分析欄位都使用台灣繁體中文；來源對話語言與原始人名不得改變輸出語言。",
  en: "RETRY LOCALE REQUIREMENT: Keep TARGET_OUTPUT_LOCALE=en. Rewrite every analysis field in English. The source transcript language and original names do not change the output locale.",
};

async function callStructured({ prompt, task, imageDataUrl, schema, maxTokens, temperature, validate, reasoningEffort, locale = "ja" }) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const model = process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";
      const usesCompletionTokens = /^(gpt-5|o\d)/i.test(model);
      const requestBody = {
        model,
        messages: [
          { role: "system", content: attempt === 0 ? prompt : `${prompt}\n\n${localeRetryInstruction[locale] || localeRetryInstruction.ja}\nRETRY VALIDATION FAILURE: ${String(lastError?.message || "INVALID_OUTPUT").slice(0, 240)}. Correct that exact failure; do not repeat the rejected wording.` },
          { role: "user", content: imageDataUrl ? [
            { type: "text", text: task },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ] : task },
        ],
        response_format: { type: "json_schema", json_schema: schema },
      };
      if (usesCompletionTokens) {
        requestBody.max_completion_tokens = Math.max(maxTokens, 2200);
        if (reasoningEffort) requestBody.reasoning_effort = reasoningEffort;
      }
      else {
        requestBody.max_tokens = maxTokens;
        requestBody.temperature = attempt === 0 ? temperature : 0;
      }
      const modelStartedAt = Date.now();
      const response = await axios.post("https://api.openai.com/v1/chat/completions", requestBody, {
        timeout: 60000,
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      });
      const modelTotalMs = Date.now() - modelStartedAt;
      const parseStartedAt = Date.now();
      const raw = parseJson(response.data?.choices?.[0]?.message?.content);
      const normalizeStartedAt = Date.now();
      const normalized = validate?.(raw);
      return { raw, response, normalized, timings: { model_ttfb_ms: null, model_total_ms: modelTotalMs, parse_ms: normalizeStartedAt - parseStartedAt, language_validate_ms: Date.now() - normalizeStartedAt } };
    } catch (error) {
      lastError = error;
      const status = Number(error?.response?.status || 0);
      if (status === 401 || status === 403 || status === 429) break;
    }
  }
  throw lastError || new Error("AI_FAILED");
}

async function analyzeConversationForWeb({ messages = [], partnerName = "", locale = "ja", context = {} }) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_NOT_CONFIGURED");
  const startedAt = Date.now();
  const model = process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";
  const transcript = messages.slice(-80).map((message) => {
    const timestamp = String(message.timestamp || "").trim();
    return `${timestamp ? `[VISIBLE TIME: ${timestamp}] ` : "[TIME UNKNOWN] "}${message.sender === "self" ? "SELF" : "PARTNER"}: ${String(message.text || "").trim()}`;
  }).filter((line) => !line.endsWith(": ")).join("\n");
  if (!transcript) throw new Error("CONVERSATION_REQUIRED");
  const main = await callStructured({
    prompt: replyProposalPrompt(locale, context),
    task: `${taskFor(locale).reply(partnerName)}\n\n${transcript}`,
    schema: replyProposalSchema, maxTokens: 1100, temperature: 0.3,
    locale,
    validate: raw => normalizeReply(raw, locale),
  });
  return {
    result: normalizeReply(main.raw, locale), model: main.response.data?.model || model,
    processingMs: Date.now() - startedAt,
    usage: aiUsageProperties(main.response, main.response.data?.model || model, "reply_idea"), auxiliaryUsages: [],
  };
}

async function analyzeConversationBaseForWeb({messages=[],partnerName="",locale="ja",context={},preparedInput}){
 if(!process.env.OPENAI_API_KEY)throw new Error("OPENAI_NOT_CONFIGURED");
 const startedAt=Date.now(),model=process.env.OPENAI_VISION_MODEL||"gpt-4.1-mini";
 const featureStartedAt=Date.now(),prepared=preparedInput||prepareDeterministicAnalysis(messages),window=prepared.window,featureExtractMs=Date.now()-featureStartedAt;
 const line=(message,label)=>`[${label}] ${message.timestamp?`[VISIBLE TIME: ${String(message.timestamp).trim()}]`:"[TIME UNKNOWN]"} ${message.sender==="self"?"SELF":"PARTNER"}: ${String(message.text||"").trim()}`;
 const transcript=[...window.baseline.map(message=>line(message,"LONG_TERM_BASELINE")),...window.recent.map(message=>line(message,"RECENT_PRIMARY"))].join("\n");
 if(!transcript)throw new Error("CONVERSATION_REQUIRED");
 const normalizeOptions={dataWindow:window.metadata,authoritativeDimensions:prepared.dimensions,inputFingerprint:prepared.fingerprint};
 const main=await callStructured({prompt:chatAnalysisPrompt(locale,{...context,dataWindow:window.metadata,authoritativeScores:prepared.dimensions}),task:`${taskFor(locale).topic(partnerName)}\n\n${transcript}`,schema:chatAnalysisSchema,maxTokens:1900,temperature:.2,locale,validate:raw=>normalizeAnalysis(raw,locale,normalizeOptions)});
 return{result:main.normalized||normalizeAnalysis(main.raw,locale,normalizeOptions),model:main.response.data?.model||model,processingMs:Date.now()-startedAt,inputFingerprint:prepared.fingerprint,timings:{feature_extract_ms:featureExtractMs,...main.timings,normalize_ms:0,total_ms:Date.now()-startedAt},usage:aiUsageProperties(main.response,main.response.data?.model||model,"chat_analysis"),auxiliaryUsages:[]};
}

async function analyzeConversationTopicForWeb({messages=[],partnerName="",locale="ja",context={}}){
 if(!process.env.OPENAI_API_KEY)throw new Error("OPENAI_NOT_CONFIGURED");
 const startedAt=Date.now(),model=process.env.OPENAI_VISION_MODEL||"gpt-4.1-mini";
 const transcript=messages.slice(-120).map(message=>`${message.timestamp?`[VISIBLE TIME: ${String(message.timestamp).trim()}]`:"[TIME UNKNOWN]"} ${message.sender==="self"?"SELF":"PARTNER"}: ${String(message.text||"").trim()}`).join("\n");
 if(!transcript)throw new Error("CONVERSATION_REQUIRED");
 const main=await callStructured({prompt:topicAnalysisPrompt(locale,context),task:`${taskFor(locale).topic(partnerName)}\n\n${transcript}`,schema:topicAnalysisSchema,maxTokens:5200,temperature:.2,reasoningEffort:"low",locale,validate:raw=>{validateTopicDepth(raw,context);assertLocale(topicStrings(raw),locale)}});
 return{result:{kind:"topic_analysis",...main.raw,topic_id:context.topicId,readiness_status:context.readinessStatus},model:main.response.data?.model||model,processingMs:Date.now()-startedAt,usage:aiUsageProperties(main.response,main.response.data?.model||model,"topic_analysis"),auxiliaryUsages:[]};
}

async function analyzeConversationThemeForWeb({messages=[],selfName="",partnerName="",locale="ja",themeId,topics=[]}){
 if(!process.env.OPENAI_API_KEY)throw new Error("OPENAI_NOT_CONFIGURED");
 const model=process.env.OPENAI_VISION_MODEL||"gpt-4.1-mini",window=selectAnalysisWindow(messages),selected=[...window.baseline.map(message=>({message,period:"BASELINE"})),...window.recent.map(message=>({message,period:"RECENT"}))],transcript=selected.map(({message,period},index)=>`${index+1}. [${period}] ${message.sender}: ${message.text} [${message.timestamp||"TIME UNKNOWN"}]`).join("\n");
 const topicContract=topics.map(topic=>({topic_id:topic.id,question:topic.question,evidenceInstruction:topic.evidenceInstruction,analysisDimensions:[...topic.requiredModules,...topic.optionalModules]}));
 const promises={futarirashisa:"TYPE answers only: What kind of two people are we, really? Give the relationship an emotionally meaningful name, then portray the lived pattern: what feels good, what is unique, the tension underneath, and why it has not moved further. Do not predict the future or answer whether one person likes the other.",feelings:"FEELINGS answers only: What is the partner's unspoken emotional state? Name the kind of feeling, what they enjoy, what they hold back or fear, and where the self person sits emotionally. Do not make this a relationship-type description or future forecast.",future:"FUTURE answers only: Is this romance viable, and what happens next? Open with a direct potential/trajectory judgment, then explain the blocker, the turning point, and what happens if nothing changes. Do not force optimism."};
 const names={self:String(selfName||"").trim().slice(0,80),partner:String(partnerName||"").trim().slice(0,80)};
 const prompt=`You write RenAI Premium Diagnosis content as a perceptive relationship expert. The result must feel emotionally resonant, personal, clear, and grounded—never like a clinical report, generic compatibility summary, motivational speech, or romantic fantasy. The reader should feel: "That is what I wanted to know," "That is exactly us," or "Now I understand what this ambiguity means."\n\nTHEME PROMISE:\n${promises[themeId]||promises.futarirashisa}\n\nPEOPLE:\n${JSON.stringify(names)}\nUse the actual names naturally whenever available. Write about these two people, not database actors. In user-facing copy, avoid system-like labels such as user, the user, other person, partner side, self, ユーザー, 相手側, and 自分. Avoid overusing あなた and 相手. Prefer the names, ふたり, 今のふたり, ふたりの間, or この関係. Do not mechanically repeat both names in every sentence.\n\nAnalyze the supplied REAL chat internally using these topic lenses. Evidence, quotes, signals, confidence scoring, reasoning, methodology, supporting/counter-evidence, and raw chat are INTERNAL ONLY and must never appear in the output.\n${JSON.stringify(topicContract)}\n\nOUTPUT CONTRACT:\n- coreQuestion: one natural, direct localized expression of this theme's single promise. Use names where that sounds natural.\n- headline: an emotionally meaningful, decisive headline. For TYPE this is a short relationship name, not a generic type label. For FEELINGS it names the emotional truth, not merely "there is interest." For FUTURE it directly answers viable/not viable/ambiguous and the current trajectory.\n- summary: one substantial, cohesive paragraph. In Japanese, target roughly 100–180 characters. It must describe a lived emotional state and connect the important tension instead of listing traits. TYPE covers what feels good, what is unique, the tension underneath, and why depth has stalled. FEELINGS covers the kind of feeling, what is enjoyed, what is held back or feared, and emotional significance. FUTURE covers trajectory, blocker, turning point, and what happens if nothing changes.\n- conclusions: exactly 3 distinct conclusions chosen dynamically for this relationship. Each has a stable id, a question the reader genuinely wants answered, a direct conclusion, and a substantial deepening that explains what the answer means specifically here. In Japanese, target roughly 70–140 characters for each deepening. Do not merely restate the conclusion.\n- The headline, summary, and three conclusions must add new value rather than repeat the same idea in different words.\n- Across themes, keep the boundaries strict: TYPE = identity/pattern; FEELINGS = the partner's internal emotional state; FUTURE = trajectory/possibility/turning point. Generic ideas such as caution, measuring distance, or slow progress must not become the central answer in all three.\n- Do not output evidence, quotations, signs, judgment basis, confidence, analysis process, advice checklists, or forced positive endings.\n- Emotional satisfaction comes from recognition, specificity, and making ambiguity understandable—not optimism. Difficult conclusions should be softened through clarity, never false hope.\n- Use decisive but calibrated language. Do not claim unknowable private thoughts as fact, and do not weaken every sentence with repetitive hedging.\n- JAPANESE EDITORIAL STANDARD: write natural contemporary Japanese, not translated analyst prose. Make the emotional mechanism the subject of each sentence. Do not stack generic labels such as 優しい, 慎重, 曖昧, 距離感, 好意, and 進展 without explaining the distinct inner conflict they create for these two people.\n- Never cite, quote, paraphrase, or enumerate concrete chat messages, purchases, plans, objects, timestamps, or observed lines in user-facing output. Do not use Japanese quotation marks. Convert all evidence into relationship-level emotional interpretation.\n- Do not write unsupported binary downgrades such as "not deep love" merely because a declaration is absent. Separate what is strongly suggested from what remains undecided without becoming clinical.\n- TYPE must not discuss the partner's hidden feelings or forecast outcomes. FEELINGS must center emotional significance and restraint, not interaction style. FUTURE must state the trajectory first and make the decisive fork concrete, not simply repeat that things are ambiguous.\n- Write only in the requested locale.`;
 const editorialPrompt=`${prompt}\n- Never mention chat, messages, questions, replies, frequency, observed wording, or behavioral evidence as the basis for a conclusion. Ban report phrases such as 見られる, うかがえる, 〜から分かる, 言動, and 表れ. Move one interpretive layer deeper: describe the emotional meaning, conflict, priority, or need itself.\n- CALIBRATE INTENSITY: emotional value comes from clarity, not flattery. Do not upgrade comfort into devotion, interest into love, or familiarity into irreplaceability. Avoid poetic inflation such as 心の奥底, 心の拠り所, かけがえのない, 心を満たしている, 深い願い, 守るべき大切な場所, or 微かな疑念が潜んでいる unless the record supports that exact intensity repeatedly and recently. Prefer plain, conversational Japanese.\n- CURRENT STATE: BASELINE items show the longer pattern; RECENT items show the current state and carry more weight. Notice warming, cooling, and reconnection rather than averaging them together. A recent concrete action can change the current interpretation, but never cite that action in user-facing copy.\n- CROSS-TAB CALIBRATION: infer one coherent relationship state and keep every claim at that level. Feelings must not describe devotion or emotional refuge when the same state supports a stalled or low-commitment Future. A cautious Future can coexist with warmth, but the intensity must match.\n- SCREENSHOT-WORTHY LINE: the headline must be one concise, memorable, plainspoken sentence that captures this relationship without poetry or slogans.\n- TYPE: make the shared relationship mechanism the subject. Each insight must cover a different axis: the unique comfort they create, who or what sets the emotional pace, and the invisible mismatch. Do not center progress, romantic interest, or either person's private feelings.\n- FEELINGS: make ${names.partner||"the partner"}'s emotional sense of ${names.self||"the self person"} explicit. The three insights must separately answer specialness/emotional priority, what ${names.partner||"the partner"} emotionally enjoys or needs here, and what ${names.partner||"the partner"} is protecting or afraid to change. Do not repeat distance/caution three times.\n- FUTURE: the headline must directly choose the current trajectory, not merely say there is possibility. The three insights must separately cover the real blocker, the concrete emotional turning point, and the likely destination if nothing changes. Use conversational question titles such as a person would actually ask; never use bureaucratic labels such as 最大の障壁 or 決定的な転機. Advice may name the kind of move needed, but must not invent a specific event.\n- Do not name concrete objects, plans, purchases, foods, places, timestamps, or individual exchanges. Do not present evidence or explain how RenAI reached the answer.\n- Use contemporary natural Japanese. Prefer emotionally exact sentences over analytical qualifiers. Every conclusion and deepening must contribute a new answer.\n- Japanese quotation marks are allowed only around an abstract relationship label or emotional category, never around chat-derived wording.`;
 const validateTheme=raw=>{if(!raw||!Array.isArray(raw.conclusions)||raw.conclusions.length!==3)throw new Error("AI_INCOMPLETE_THEME_REPORT");const length=value=>typeof value==="string"?value.replace(/\s/g,"").length:0,prose=topicStrings(raw).join("\n");if(length(raw.coreQuestion)<8||length(raw.headline)<12||length(raw.summary)<80||raw.conclusions.some(item=>!item?.id||length(item.question)<8||length(item.conclusion)<20||length(item.deepening)<60))throw new Error("AI_SHALLOW_THEME_REPORT");if(/\b(?:user|other person|partner side|self)\b/iu.test(prose)||/\u30e6\u30fc\u30b6\u30fc|\u76f8\u624b\u5074/u.test(prose))throw new Error("AI_USER_FACING_SYSTEM_LANGUAGE");assertLocale(topicStrings(raw),locale)};
 const draft=await callStructured({prompt:editorialPrompt,task:`${taskFor(locale).topic(partnerName)}\n\n${transcript}`,schema:themeReportSchema,maxTokens:6200,temperature:.35,reasoningEffort:"low",validate:validateTheme});
 const finalPrompt=`You are the final Japanese relationship editor for RenAI. Expand the supplied abstract conclusions into the final user-facing Premium report. Keep their grounded meaning, but remove every trace of evidence reporting. Never mention or imply chat, messages, exchanges, questions, replies, wording, frequency, observations, signs, examples, or how the answer was inferred. In Japanese output, do not use the words 会話, メッセージ, やりとり, やり取り, 返答, 質問, 提案, 冗談, 言葉の裏, 態度, サイン, 見られる, うかがえる, or 表れ. Never cite a concrete object, plan, place, food, purchase, or timestamp. Write only the emotional meaning itself.\n\nPEOPLE: ${JSON.stringify(names)}\nTHEME: ${promises[themeId]||promises.futarirashisa}\nUse the actual names naturally and never use database-actor language. Keep one concise, memorable, plainspoken headline, one cohesive substantial summary, and exactly three distinct conclusions. Write like a perceptive person speaking naturally, not a report. Use simple conversational question titles, not formal labels. Each deepening must explain what the answer means emotionally for this relationship, not provide proof. Emotional value comes from clarity, never flattery or poetic intensity. Do not turn comfort into devotion or uncertainty into hidden passion. Avoid 心の奥底, 心の拠り所, かけがえのない, 心を満たしている, 深い願い, 守るべき大切な場所, 微かな疑念, and 潜んでいる. TYPE stays on shared identity/pattern; FEELINGS stays on ${names.partner||"the partner"}'s inner emotional state toward ${names.self||"the self person"}; FUTURE stays on trajectory, turning point, and likely destination. Use contemporary natural Japanese and do not add optimism, motivation, or certainty unsupported by the abstract conclusions.`;
 const scrubEvidenceLanguage=value=>typeof value==="string"?value.replace(/会話/g,"関係").replace(/メッセージ/g,"気持ち").replace(/やり[取りと]り/g,"ふたりの時間").replace(/返答/g,"反応").replace(/質問/g,"気がかり").replace(/提案/g,"働きかけ").replace(/冗談/g,"軽やかさ").replace(/言葉の裏/g,"心の奥").replace(/態度/g,"向き合い方").replace(/サイン/g,"気配").replace(/見られる/g,"ある").replace(/うかがえる/g,"感じられる").replace(/表れ/g,"かたち"):value;
 const editorialInput={coreQuestion:scrubEvidenceLanguage(draft.raw.coreQuestion),headline:scrubEvidenceLanguage(draft.raw.headline),conclusions:draft.raw.conclusions.map(({id,question,conclusion})=>({id,question:scrubEvidenceLanguage(question),conclusion:scrubEvidenceLanguage(conclusion)}))};
 const validateFinal=raw=>{validateTheme(raw);const prose=topicStrings(raw).join("\n"),forbidden=["会話","メッセージ","やりとり","やり取り","返答","質問","提案","冗談","言葉の裏","態度","サイン","見られる","うかがえる","表れ","心の奥底","心の拠り所","かけがえのない","心を満たしている","深い願い","守るべき大切な場所","微かな疑念","潜んでいる","最大の障壁","決定的な転機"],matched=forbidden.filter(term=>prose.includes(term));if(matched.length)throw new Error(`AI_USER_FACING_EVIDENCE_LANGUAGE:${matched.join(",")}`)};
 const final=await callStructured({prompt:finalPrompt,task:JSON.stringify(editorialInput),schema:themeReportSchema,maxTokens:6200,temperature:.3,reasoningEffort:"low",validate:validateFinal});
 return{result:final.raw,model:final.response.data?.model||model,usage:aiUsageProperties(final.response,final.response.data?.model||model,"diagnosis_theme_report"),auxiliaryUsages:[aiUsageProperties(draft.response,draft.response.data?.model||model,"diagnosis_theme_report_draft")]};
}

async function analyzeForWeb({ imageBuffer, mimeType, mode, locale = "ja", context = {} }) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_NOT_CONFIGURED");
  const startedAt = Date.now();
  const model = process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";
  const imageDataUrl = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

  if (mode === "reply") {
    const main = await callStructured({
      prompt: replyProposalPrompt(locale, context),
      task: taskFor(locale).screenshotReply,
      imageDataUrl, schema: replyProposalSchema, maxTokens: 1100, temperature: 0.3,
      locale,
      validate: raw => normalizeReply(raw, locale),
    });
    const result = normalizeReply(main.raw, locale);
    return {
      result, model: main.response.data?.model || model,
      processingMs: Date.now() - startedAt,
      usage: aiUsageProperties(main.response, main.response.data?.model || model, "reply_idea"),
      auxiliaryUsages: [],
    };
  }

  const main = await callStructured({
    prompt: chatAnalysisPrompt(locale, context),
    task: taskFor(locale).screenshotAnalysis,
    imageDataUrl, schema: chatAnalysisSchema, maxTokens: 1700, temperature: 0.2,
    locale,
    validate: raw => normalizeAnalysis(raw, locale),
  });
  const result = normalizeAnalysis(main.raw, locale);
  return {
    result, model: main.response.data?.model || model,
    processingMs: Date.now() - startedAt,
    usage: aiUsageProperties(main.response, main.response.data?.model || model, "chat_analysis"),
    auxiliaryUsages: [],
  };
}

module.exports = { analyzeForWeb, analyzeConversationForWeb, analyzeConversationBaseForWeb, analyzeConversationTopicForWeb, analyzeConversationThemeForWeb, prepareDeterministicAnalysis };
