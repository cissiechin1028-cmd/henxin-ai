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
 const trajectorySchema={name:"renai_internal_relationship_trajectory",strict:true,schema:{type:"object",additionalProperties:false,required:["stages","currentDirection","currentState","recentChanges","nextProgressSignals","nextStallSignals"],properties:{stages:{type:"array",minItems:2,maxItems:4,items:{type:"object",additionalProperties:false,required:["period","direction","initiator","behavior"],properties:{period:{type:"string"},direction:{type:"string",enum:["warming","cooling","reconnecting","stalled","stable"]},initiator:{type:"string"},behavior:{type:"string"}}}},currentDirection:{type:"string",enum:["warming","cooling","reconnecting","stalled","stable"]},currentState:{type:"string"},recentChanges:{type:"array",minItems:1,maxItems:5,items:{type:"object",additionalProperties:false,required:["actor","behavior","changeFromEarlier"],properties:{actor:{type:"string"},behavior:{type:"string"},changeFromEarlier:{type:"string"}}}},nextProgressSignals:{type:"array",minItems:1,maxItems:3,items:{type:"string"}},nextStallSignals:{type:"array",minItems:1,maxItems:3,items:{type:"string"}}}}};
 const trajectoryPrompt=`You are RenAI's internal chronology checker. Read the dated BASELINE and RECENT records in order and map how the relationship changed. This is factual preparation for another model, not user-facing prose. Track who initiated each action correctly using PEOPLE=${JSON.stringify(names)} and sender mapping self=${names.self||"self"}, partner=${names.partner||"partner"}. Give RECENT and the latest dated actions more weight than older patterns. Detect cooling followed by renewed initiative, a declined or delayed plan being revived, continued initiative after meeting, concrete next plans, explicit desire to meet, and a shift toward discussing the relationship in person. The latest meaningful reversal defines currentDirection unless a still later reversal cancels it. Do not average the whole history. Do not infer love or private motives. Paraphrase behaviors without quoting private text.`;
 const trajectory=await callStructured({prompt:trajectoryPrompt,task:transcript,schema:trajectorySchema,maxTokens:2200,temperature:0,reasoningEffort:"low",validate:raw=>{if(!raw||!Array.isArray(raw.stages)||raw.stages.length<2||!Array.isArray(raw.recentChanges)||!raw.currentDirection)throw new Error("AI_INVALID_TRAJECTORY")}});
 const prompt=`You write RenAI Premium Diagnosis content as a perceptive relationship expert. The result must feel emotionally resonant, personal, clear, and grounded—never like a clinical report, generic compatibility summary, motivational speech, or romantic fantasy. The reader should feel: "That is what I wanted to know," "That is exactly us," or "Now I understand what this ambiguity means."\n\nTHEME PROMISE:\n${promises[themeId]||promises.futarirashisa}\n\nPEOPLE:\n${JSON.stringify(names)}\nUse the actual names naturally whenever available. Write about these two people, not database actors. In user-facing copy, avoid system-like labels such as user, the user, other person, partner side, self, ユーザー, 相手側, and 自分. Avoid overusing あなた and 相手. Prefer the names, ふたり, 今のふたり, ふたりの間, or この関係. Do not mechanically repeat both names in every sentence.\n\nAnalyze the supplied REAL chat internally using these topic lenses. Evidence, quotes, signals, confidence scoring, reasoning, methodology, supporting/counter-evidence, and raw chat are INTERNAL ONLY and must never appear in the output.\n${JSON.stringify(topicContract)}\n\nOUTPUT CONTRACT:\n- coreQuestion: one natural, direct localized expression of this theme's single promise. Use names where that sounds natural.\n- headline: an emotionally meaningful, decisive headline. For TYPE this is a short relationship name, not a generic type label. For FEELINGS it names the emotional truth, not merely "there is interest." For FUTURE it directly answers viable/not viable/ambiguous and the current trajectory.\n- summary: one substantial, cohesive paragraph. In Japanese, target roughly 100–180 characters. It must describe a lived emotional state and connect the important tension instead of listing traits. TYPE covers what feels good, what is unique, the tension underneath, and why depth has stalled. FEELINGS covers the kind of feeling, what is enjoyed, what is held back or feared, and emotional significance. FUTURE covers trajectory, blocker, turning point, and what happens if nothing changes.\n- conclusions: exactly 3 distinct conclusions chosen dynamically for this relationship. Each has a stable id, a question the reader genuinely wants answered, a direct conclusion, and a substantial deepening that explains what the answer means specifically here. In Japanese, target roughly 70–140 characters for each deepening. Do not merely restate the conclusion.\n- The headline, summary, and three conclusions must add new value rather than repeat the same idea in different words.\n- Across themes, keep the boundaries strict: TYPE = identity/pattern; FEELINGS = the partner's internal emotional state; FUTURE = trajectory/possibility/turning point. Generic ideas such as caution, measuring distance, or slow progress must not become the central answer in all three.\n- Do not output evidence, quotations, signs, judgment basis, confidence, analysis process, advice checklists, or forced positive endings.\n- Emotional satisfaction comes from recognition, specificity, and making ambiguity understandable—not optimism. Difficult conclusions should be softened through clarity, never false hope.\n- Use decisive but calibrated language. Do not claim unknowable private thoughts as fact, and do not weaken every sentence with repetitive hedging.\n- JAPANESE EDITORIAL STANDARD: write natural contemporary Japanese, not translated analyst prose. Make the emotional mechanism the subject of each sentence. Do not stack generic labels such as 優しい, 慎重, 曖昧, 距離感, 好意, and 進展 without explaining the distinct inner conflict they create for these two people.\n- Never cite, quote, paraphrase, or enumerate concrete chat messages, purchases, plans, objects, timestamps, or observed lines in user-facing output. Do not use Japanese quotation marks. Convert all evidence into relationship-level emotional interpretation.\n- Do not write unsupported binary downgrades such as "not deep love" merely because a declaration is absent. Separate what is strongly suggested from what remains undecided without becoming clinical.\n- TYPE must not discuss the partner's hidden feelings or forecast outcomes. FEELINGS must center emotional significance and restraint, not interaction style. FUTURE must state the trajectory first and make the decisive fork concrete, not simply repeat that things are ambiguous.\n- Write only in the requested locale.`;
 const behaviorPrompt=prompt.replace("Never cite, quote, paraphrase, or enumerate concrete chat messages, purchases, plans, objects, timestamps, or observed lines in user-facing output. Do not use Japanese quotation marks. Convert all evidence into relationship-level emotional interpretation.","Never quote exact private text or timestamps. Paraphrase only the few concrete behaviors and changes that materially drive the conclusion, then explain their relationship meaning. Do not turn them into an evidence list.");
 const editorialPrompt=`${behaviorPrompt}\n- Never present behavior as proof or an evidence list. Instead, select the one concrete change that carries the most relationship meaning and interpret it.\n- CALIBRATE INTENSITY: emotional value comes from clarity, not flattery. Do not upgrade comfort into devotion, interest into love, or familiarity into irreplaceability. Avoid poetic inflation. Prefer plain, conversational Japanese.\n- MANDATORY TRAJECTORY PASS (internal only): before drafting, read the dated sequence as stages, not an average. Identify the earlier state, any cooling or withdrawal, the latest meaningful reversal, and the state after that reversal. BASELINE shows the longer pattern; RECENT carries more weight. The last meaningful direction overrides an older cold period unless a still later reversal cancels it. Renewed initiative, rebooking after a decline, restored contact, explicit desire to meet, concrete future plans, or moving an emotional topic toward an in-person discussion are relationship-changing events, not minor details. If they occur after cooling, the current state must be reconnecting or moving again—not still cooling or simply stagnant.\n- BEHAVIOR FIRST: every card must name one non-obvious behavioral change or pattern, then answer what that behavior means. Generic caution, distance, trust, honesty, or communication can support the explanation but cannot be the main insight. Do not repeat the same behavior or abstract label across cards.\n- CROSS-TAB CALIBRATION: infer one coherent current relationship state and keep every claim at that level. Feelings must not describe devotion when the same state supports low commitment.\n- SO-WHAT TEST: each conclusion must tell the reader what to understand now. Each deepening must explain why the selected behavior matters, what changed, or which uncertainty it resolves.\n- TYPE: identify the behavior pattern unique to these two, who actually keeps the connection moving, and how the pair handles closeness. Do not answer hidden feelings or predict outcomes.\n- FEELINGS: prioritize what renewed initiative means, whether warmth is intentional rather than polite, whether the connection is being actively maintained, and what the recent reversal says about ${names.partner||"the partner"}'s current position.\n- FUTURE IS NOT ADVICE: do not prescribe honest conversation, trust-building, communication, or adjusting distance. Directly classify the current direction, name the recent behavior that matters most, identify the most likely next movement, and make the branch point behavioral: whether the next plan happens, initiative continues afterward, an in-person relationship discussion happens, or contact remains mutual. Choose only what this record supports.\n- Use ordinary Japanese a 20-year-old immediately understands. Avoid therapy language and report endings. Every conclusion and deepening must add a different paid insight. Do not quote exact private wording.`;
 const validateTheme=raw=>{if(!raw||!Array.isArray(raw.conclusions)||raw.conclusions.length!==3)throw new Error("AI_INCOMPLETE_THEME_REPORT");const length=value=>typeof value==="string"?value.replace(/\s/g,"").length:0,prose=topicStrings(raw).join("\n");if(length(raw.coreQuestion)<8||length(raw.headline)<12||length(raw.summary)<80||raw.conclusions.some(item=>!item?.id||length(item.question)<8||length(item.conclusion)<20||length(item.deepening)<60))throw new Error("AI_SHALLOW_THEME_REPORT");if(/\b(?:user|other person|partner side|self)\b/iu.test(prose)||/\u30e6\u30fc\u30b6\u30fc|\u76f8\u624b\u5074/u.test(prose))throw new Error("AI_USER_FACING_SYSTEM_LANGUAGE");assertLocale(topicStrings(raw),locale)};
 const draft=await callStructured({prompt:editorialPrompt,task:`${taskFor(locale).topic(partnerName)}\n\nINTERNAL TRAJECTORY MAP (facts and chronology; never expose as an evidence list):\n${JSON.stringify(trajectory.raw)}\n\nSOURCE RECORD:\n${transcript}`,schema:themeReportSchema,maxTokens:6200,temperature:.35,reasoningEffort:"low",validate:validateTheme});
 const finalPrompt=`You are the final Japanese relationship editor for RenAI. Expand the supplied abstract conclusions into the final user-facing Premium report. Preserve the draft's current trajectory and grounded meaning, but remove every trace of evidence reporting. Never mention or imply chat, messages, exchanges, questions, replies, wording, frequency, observations, signs, examples, or how the answer was inferred. In Japanese output, do not use the words 会話, メッセージ, やりとり, やり取り, 返答, 質問, 提案, 冗談, 言葉の裏, 態度, サイン, 見られる, うかがえる, or 表れ. Never cite a concrete object, plan, place, food, purchase, or timestamp. Write only what the relationship sequence means now.\n\nPEOPLE: ${JSON.stringify(names)}\nTHEME: ${promises[themeId]||promises.futarirashisa}\nUse the actual names naturally and never use database-actor language. Keep one concise, memorable, plainspoken headline, one cohesive substantial summary, and exactly three distinct conclusions. Write like someone extremely good at reading relationships, not a therapist or report writer. Use simple conversational question titles. Every conclusion must pass the SO-WHAT test: directly answer what the reader wants to know, then use the deepening to explain why it matters now, what the recent change alters, or what uncertainty it resolves. Do not leave pace, comfort, distance, caution, or mismatch as the answer. Emotional value comes from revelation and clarity, never flattery or poetic intensity. Do not turn comfort into devotion or uncertainty into hidden passion. Avoid 心の奥底, 心の拠り所, かけがえのない, 心を満たしている, 深い願い, 守るべき大切な場所, 微かな疑念, 潜んでいる, 感情の安全, 内面のバランス, 心の安全, 感情を大きく開く, 心の壁, and 内面的. Never finish with 〜を意味しています, 〜を示しています, or 〜ことを表しています. TYPE stays on shared identity/pattern; FEELINGS stays on ${names.partner||"the partner"}'s current emotional position toward ${names.self||"the self person"}; FUTURE stays on the current trajectory and next turning point. Use contemporary natural Japanese and do not add optimism, motivation, or certainty unsupported by the abstract conclusions.`;
 const scrubEvidenceLanguage=value=>typeof value==="string"?value.replace(/会話/g,"関係").replace(/メッセージ/g,"気持ち").replace(/やり[取りと]り/g,"ふたりの時間").replace(/返答/g,"反応").replace(/質問/g,"気がかり").replace(/提案/g,"働きかけ").replace(/冗談/g,"軽やかさ").replace(/言葉の裏/g,"本音").replace(/態度/g,"向き合い方").replace(/サイン/g,"気配").replace(/見られる/g,"ある").replace(/うかがえる/g,"感じられる").replace(/表れ/g,"かたち").replace(/心の奥底/g,"本音の部分").replace(/心の拠り所/g,"安心できる存在").replace(/かけがえのない/g,"大切な").replace(/心を満たしている/g,"安心につながっている").replace(/深い願い/g,"強い気持ち").replace(/守るべき大切な場所/g,"失いたくない関係").replace(/微かな疑念/g,"小さな不安").replace(/潜んでいる/g,"残っている").replace(/最大の障壁/g,"あと一歩進めない理由").replace(/決定的な転機/g,"次に関係が動くきっかけ").replace(/感情の安全/g,"傷つかない距離").replace(/内面のバランス/g,"今の落ち着き").replace(/心の安全/g,"安心できる距離").replace(/感情を大きく開く/g,"本音を見せる").replace(/心の壁/g,"ためらい").replace(/内面的/g,"気持ちの").replace(/を意味しています/g,"ということです").replace(/を示しています/g,"といえます").replace(/ことを表しています/g,"ことです"):value;
 const editorialInput={trajectory:trajectory.raw,coreQuestion:scrubEvidenceLanguage(draft.raw.coreQuestion),headline:scrubEvidenceLanguage(draft.raw.headline),summary:scrubEvidenceLanguage(draft.raw.summary),conclusions:draft.raw.conclusions.map(({id,question,conclusion,deepening})=>({id,question:scrubEvidenceLanguage(question),conclusion:scrubEvidenceLanguage(conclusion),deepening:scrubEvidenceLanguage(deepening)}))};
 const behavioralFinalPrompt=finalPrompt.replace("Never cite a concrete object, plan, place, food, purchase, or timestamp. Write only what the relationship sequence means now.","Never quote exact private text or timestamps. Keep the few concrete behaviors and changes that drive the conclusion, then state what they mean now.")+`\n\nFINAL BEHAVIOR RULE: Preserve the draft's concrete trajectory details. Each card must lead with one specific behavioral change or pattern and then answer SO WHAT. Do not reduce it to distance, caution, anxiety, trust, honesty, or communication. FUTURE is prediction, not counseling: name the current direction, the likely next behavior, the concrete branch signal, and what stalling again would look like. Do not default to talking honestly, building trust, adjusting distance, or communication is key. Do not quote exact private wording or present an evidence list.`;
 const validateFinal=raw=>{validateTheme(raw);const prose=topicStrings(raw).join("\n"),detailProse=[raw.summary,...raw.conclusions.flatMap(item=>[item.question,item.conclusion,item.deepening])].join("\n"),forbidden=["判断の根拠","サイン","見られる","うかがえる","表れ","心の奥底","心の拠り所","かけがえのない","心を満たしている","深い願い","守るべき大切な場所","微かな疑念","潜んでいる","最大の障壁","決定的な転機","感情の安全","内面のバランス","心の安全","感情を大きく開く","心の壁","内面的","を意味しています","を示しています","ことを表しています","率直に話し合うことが必要","距離感を調整する必要","信頼を築くことが不可欠","はっきりさせることが急務","コミュニケーションが鍵"],matched=forbidden.filter(term=>prose.includes(term));if(matched.length)throw new Error(`AI_USER_FACING_EVIDENCE_LANGUAGE:${matched.join(",")}`);if(/[「」]/u.test(detailProse))throw new Error("AI_USER_FACING_RAW_QUOTE")};
 const final=await callStructured({prompt:behavioralFinalPrompt,task:JSON.stringify(editorialInput),schema:themeReportSchema,maxTokens:6200,temperature:.3,reasoningEffort:"low",validate:validateFinal});
 return{result:final.raw,model:final.response.data?.model||model,usage:aiUsageProperties(final.response,final.response.data?.model||model,"diagnosis_theme_report"),auxiliaryUsages:[aiUsageProperties(trajectory.response,trajectory.response.data?.model||model,"diagnosis_theme_trajectory"),aiUsageProperties(draft.response,draft.response.data?.model||model,"diagnosis_theme_report_draft")]};
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
