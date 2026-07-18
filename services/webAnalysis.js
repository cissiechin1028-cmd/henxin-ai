const axios = require("axios");
const { aiUsageProperties } = require("../tracking/cost");

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
    conversationTemperature: clampScore(raw.conversationTemperature ?? raw.naturalness),
    temperatureReason: String(raw.temperatureReason || raw.conversationRead || "").trim(),
    recommendedReply: raw.recommendedReply.trim(),
    alternatives: Array.isArray(raw.alternatives)
      ? raw.alternatives.slice(0, 2).map((item) => ({
          tone: String(item?.tone || "別案").slice(0, 20),
          text: String(item?.text || "").trim()
        })).filter((item) => item.text)
      : [],
    reason: String(raw.reason || "").trim(),
    caution: raw.caution ? String(raw.caution).trim() : undefined,
    conversationRead: String(raw.conversationRead || "").trim()
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
    scoreReasons: {
      affection: String(raw?.scoreReasons?.affection || "").trim(),
      intentConsistency: String(raw?.scoreReasons?.intentConsistency || "").trim(),
      relationshipTrend: String(raw?.scoreReasons?.relationshipTrend || "").trim(),
      progressRisk: String(raw?.scoreReasons?.progressRisk || "").trim()
    },
    overallReason: String(raw?.overallReason || "").trim(),
    summary: String(raw?.summary || "").trim(),
    currentPsychology: String(raw?.currentPsychology || "").trim(),
    evidence: Array.isArray(raw?.evidence) ? raw.evidence.slice(0, 4).map(String).filter(Boolean) : [],
    keyMoments: Array.isArray(raw?.keyMoments) ? raw.keyMoments.slice(0, 3).map((item) => ({
      quote: String(item?.quote || "").trim(),
      interpretation: String(item?.interpretation || "").trim()
    })).filter((item) => item.quote && item.interpretation) : [],
    actions: Array.isArray(raw?.actions) ? raw.actions.slice(0, 3).map(String).filter(Boolean) : [],
    nextBestMove: String(raw?.nextBestMove || "").trim(),
    timelineEvent: raw?.timelineEvent?.shouldRecord && raw.timelineEvent?.title
      ? {
          shouldRecord: true,
          eventType: String(raw.timelineEvent.eventType || "custom").slice(0, 64),
          title: String(raw.timelineEvent.title).trim().slice(0, 120),
          note: String(raw.timelineEvent.note || "").trim().slice(0, 2000)
        }
      : { shouldRecord: false }
  };
}

function outputLanguage(locale) {
  if (locale === "zh-TW") return "所有面向使用者的文字請使用台灣繁體中文。";
  if (locale === "en") return "Write every user-facing field in clear, natural English.";
  return "利用者向けの文章は、自然で読みやすい日本語にしてください。";
}

function culturalGuidance(locale) {
  if (locale === "zh-TW") {
    return "請依台灣日常聊天習慣判讀與撰寫：語氣自然、真誠、親切且清楚，使用台灣常用詞，不使用中國大陸用語或翻譯腔。可以直接表達感受，但不要逼迫對方表態。";
  }
  if (locale === "en") {
    return "Use contemporary English-language dating norms: value clear intent, consent, personal boundaries, and direct but considerate communication. Do not treat brevity or response delay alone as rejection.";
  }
  return "日本語のチャット文化に合わせ、敬語とため口の距離感、返答の間合い、婉曲表現を慎重に扱ってください。短文や返信間隔だけで脈なしと決めつけず、相手に圧力を与えない自然な表現にしてください。";
}

function systemPrompt(mode, locale) {
  const common = `あなたは恋愛コミュニケーションを支援する分析AIです。あらゆるチャットアプリのスクリーンショットに対応し、吹き出しの左右や連続する画像の順序を慎重に読み取ってください。画像で確認できない内容を作らず、観察できる事実と推測を区別し、相手の心理を断定しないでください。名前、アカウント名、連絡先などの個人情報は結果に転記しないでください。操作的、攻撃的、依存を促す表現は提案しないでください。${outputLanguage(locale)}${culturalGuidance(locale)}出力は指定されたJSONだけにしてください。`;
  if (mode === "reply") {
    return `${common}
目的は、利用者の気持ちを守りながら、その場の会話に自然につながる「次のひと言」を作ることです。
- conversationRead: 画像から確認できる現在の状況だけを1〜2文で整理する。相手の本音を断定しない。
- conversationTemperature: 0〜100。双方の反応の積極性、感情表現、話題を続ける意思、質問や提案の有無、距離感、自己開示を総合し、現在の会話の温度を採点する。好感度や将来の関係を直接示す点数ではない。返信の速さだけで極端な点数にしない。
- temperatureReason: 点数の根拠となった観察可能な会話の特徴を1〜2文で説明する。相手の本音を断定しない。
- recommendedReply: 現在の会話温度に最も合う第一候補。説明を付けず、そのまま送れる完成文にする。
- alternatives: 第一候補の言い換えではなく、異なる目的の案を2件だけ作る。1件は少し温かく、もう1件は距離や境界を守る方向にする。第一候補と合わせて合計3案にする。
- reason: なぜ第一候補が今の会話に適するかを簡潔に説明し、conversationReadを繰り返さない。
- caution: 誤解、圧力、個人情報など実際に注意点がある場合だけ記載し、なければ空文字にする。
過剰な好意、関係性の決めつけ、相手を試す表現、返信を迫る表現は避けてください。文章量と絵文字の有無は、見えている会話のテンポに合わせてください。
次の形式のみを返してください：{"conversationTemperature":0,"temperatureReason":"","conversationRead":"","recommendedReply":"","alternatives":[{"tone":"","text":""},{"tone":"","text":""}],"reason":"","caution":""}`;
  }
  return `${common}
会話全体を次の4指標で分析してください。
1. affection（好感度）: 0は関心を示す反応がほぼない状態、50は判断材料が拮抗または不足、100は継続的で明確な関心が見える状態。
2. intentConsistency（本音一致度）: 発言、返信の仕方、行動の方向性がどれほど一貫しているか。情報不足だけを理由に極端な点数にしないこと。
3. relationshipTrend（関係トレンド）: rising、stable、fallingのいずれか。直近の会話の変化を優先すること。
4. progressRisk（推進リスク）: 今すぐ距離を縮めようとした場合の負担や逆効果の可能性。0は低リスク、100は高リスク。

scoreReasonsでは各指標の理由をそれぞれ1〜2文で説明し、同じ表現を使い回さないでください。overallReasonは4指標を統合した結論だけを書き、各理由を繰り返さないでください。actionsは互いに異なる具体的な行動を必ず3件、実行しやすい順に出してください。nextBestMoveは最優先の一歩を1文で示してください。summaryは分析全体を一言で表す短い見出し、currentPsychologyは断定を避けた現在の相手の状態だけを書いてください。

quoteは画像内で実際に確認できる短い発言だけを引用してください。誕生日、旅行、交際確認、喧嘩、仲直りなど関係の節目が画像から明確に確認できる場合だけtimelineEvent.shouldRecordをtrueにし、個人情報や会話本文を含めない短い出来事としてまとめてください。通常の会話ならfalseにしてください。

次の形式のみを返してください：{"affection":0,"intentConsistency":0,"relationshipTrend":"rising|stable|falling","progressRisk":0,"scoreReasons":{"affection":"","intentConsistency":"","relationshipTrend":"","progressRisk":""},"summary":"","currentPsychology":"","overallReason":"","evidence":[""],"keyMoments":[{"quote":"","interpretation":""}],"actions":["","", ""],"nextBestMove":"","timelineEvent":{"shouldRecord":false,"eventType":"custom","title":"","note":""}}`;
}

async function analyzeForWeb({ imageBuffer, mimeType, mode, locale = "ja" }) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_NOT_CONFIGURED");
  const startedAt = Date.now();
  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt(mode, locale) },
        {
          role: "user",
          content: [
            { type: "text", text: mode === "reply" ? "この会話に対する次の返信を作ってください。" : "この会話の関係性を分析してください。" },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBuffer.toString("base64")}` } }
          ]
        }
      ],
      temperature: 0.35,
      max_tokens: mode === "reply" ? 700 : 1400,
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
    processingMs: Date.now() - startedAt,
    usage: aiUsageProperties(
      response,
      response.data?.model || process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini",
      mode === "reply" ? "reply_idea" : "chat_analysis"
    )
  };
}

module.exports = { analyzeForWeb };
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
    conversationTemperature: clampScore(raw.conversationTemperature ?? raw.naturalness),
    temperatureReason: String(raw.temperatureReason || raw.conversationRead || "").trim(),
    recommendedReply: raw.recommendedReply.trim(),
    alternatives: Array.isArray(raw.alternatives)
      ? raw.alternatives.slice(0, 2).map((item) => ({
          tone: String(item?.tone || "別案").slice(0, 20),
          text: String(item?.text || "").trim()
        })).filter((item) => item.text)
      : [],
    reason: String(raw.reason || "").trim(),
    caution: raw.caution ? String(raw.caution).trim() : undefined,
    conversationRead: String(raw.conversationRead || "").trim()
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
    scoreReasons: {
      affection: String(raw?.scoreReasons?.affection || "").trim(),
      intentConsistency: String(raw?.scoreReasons?.intentConsistency || "").trim(),
      relationshipTrend: String(raw?.scoreReasons?.relationshipTrend || "").trim(),
      progressRisk: String(raw?.scoreReasons?.progressRisk || "").trim()
    },
    overallReason: String(raw?.overallReason || "").trim(),
    summary: String(raw?.summary || "").trim(),
    currentPsychology: String(raw?.currentPsychology || "").trim(),
    evidence: Array.isArray(raw?.evidence) ? raw.evidence.slice(0, 4).map(String).filter(Boolean) : [],
    keyMoments: Array.isArray(raw?.keyMoments) ? raw.keyMoments.slice(0, 3).map((item) => ({
      quote: String(item?.quote || "").trim(),
      interpretation: String(item?.interpretation || "").trim()
    })).filter((item) => item.quote && item.interpretation) : [],
    actions: Array.isArray(raw?.actions) ? raw.actions.slice(0, 3).map(String).filter(Boolean) : [],
    nextBestMove: String(raw?.nextBestMove || "").trim(),
    timelineEvent: raw?.timelineEvent?.shouldRecord && raw.timelineEvent?.title
      ? {
          shouldRecord: true,
          eventType: String(raw.timelineEvent.eventType || "custom").slice(0, 64),
          title: String(raw.timelineEvent.title).trim().slice(0, 120),
          note: String(raw.timelineEvent.note || "").trim().slice(0, 2000)
        }
      : { shouldRecord: false }
  };
}

function outputLanguage(locale) {
  if (locale === "zh-TW") return "所有面向使用者的文字請使用台灣繁體中文。";
  if (locale === "en") return "Write every user-facing field in clear, natural English.";
  return "利用者向けの文章は、自然で読みやすい日本語にしてください。";
}

function culturalGuidance(locale) {
  if (locale === "zh-TW") {
    return "請依台灣日常聊天習慣判讀與撰寫：語氣自然、真誠、親切且清楚，使用台灣常用詞，不使用中國大陸用語或翻譯腔。可以直接表達感受，但不要逼迫對方表態。";
  }
  if (locale === "en") {
    return "Use contemporary English-language dating norms: value clear intent, consent, personal boundaries, and direct but considerate communication. Do not treat brevity or response delay alone as rejection.";
  }
  return "日本語のチャット文化に合わせ、敬語とため口の距離感、返答の間合い、婉曲表現を慎重に扱ってください。短文や返信間隔だけで脈なしと決めつけず、相手に圧力を与えない自然な表現にしてください。";
}

function systemPrompt(mode, locale) {
  const common = `あなたは恋愛コミュニケーションを支援する分析AIです。あらゆるチャットアプリのスクリーンショットに対応し、吹き出しの左右や連続する画像の順序を慎重に読み取ってください。画像で確認できない内容を作らず、観察できる事実と推測を区別し、相手の心理を断定しないでください。名前、アカウント名、連絡先などの個人情報は結果に転記しないでください。操作的、攻撃的、依存を促す表現は提案しないでください。${outputLanguage(locale)}${culturalGuidance(locale)}出力は指定されたJSONだけにしてください。`;
  if (mode === "reply") {
    return `${common}
目的は、利用者の気持ちを守りながら、その場の会話に自然につながる「次のひと言」を作ることです。
- conversationRead: 画像から確認できる現在の状況だけを1〜2文で整理する。相手の本音を断定しない。
- conversationTemperature: 0〜100。双方の反応の積極性、感情表現、話題を続ける意思、質問や提案の有無、距離感、自己開示を総合し、現在の会話の温度を採点する。好感度や将来の関係を直接示す点数ではない。返信の速さだけで極端な点数にしない。
- temperatureReason: 点数の根拠となった観察可能な会話の特徴を1〜2文で説明する。相手の本音を断定しない。
- recommendedReply: 現在の会話温度に最も合う第一候補。説明を付けず、そのまま送れる完成文にする。
- alternatives: 第一候補の言い換えではなく、異なる目的の案を2件だけ作る。1件は少し温かく、もう1件は距離や境界を守る方向にする。第一候補と合わせて合計3案にする。
- reason: なぜ第一候補が今の会話に適するかを簡潔に説明し、conversationReadを繰り返さない。
- caution: 誤解、圧力、個人情報など実際に注意点がある場合だけ記載し、なければ空文字にする。
過剰な好意、関係性の決めつけ、相手を試す表現、返信を迫る表現は避けてください。文章量と絵文字の有無は、見えている会話のテンポに合わせてください。
次の形式のみを返してください：{"conversationTemperature":0,"temperatureReason":"","conversationRead":"","recommendedReply":"","alternatives":[{"tone":"","text":""},{"tone":"","text":""}],"reason":"","caution":""}`;
  }
  return `${common}
会話全体を次の4指標で分析してください。
1. affection（好感度）: 0は関心を示す反応がほぼない状態、50は判断材料が拮抗または不足、100は継続的で明確な関心が見える状態。
2. intentConsistency（本音一致度）: 発言、返信の仕方、行動の方向性がどれほど一貫しているか。情報不足だけを理由に極端な点数にしないこと。
3. relationshipTrend（関係トレンド）: rising、stable、fallingのいずれか。直近の会話の変化を優先すること。
4. progressRisk（推進リスク）: 今すぐ距離を縮めようとした場合の負担や逆効果の可能性。0は低リスク、100は高リスク。

scoreReasonsでは各指標の理由をそれぞれ1〜2文で説明し、同じ表現を使い回さないでください。overallReasonは4指標を統合した結論だけを書き、各理由を繰り返さないでください。actionsは互いに異なる具体的な行動を必ず3件、実行しやすい順に出してください。nextBestMoveは最優先の一歩を1文で示してください。summaryは分析全体を一言で表す短い見出し、currentPsychologyは断定を避けた現在の相手の状態だけを書いてください。

quoteは画像内で実際に確認できる短い発言だけを引用してください。誕生日、旅行、交際確認、喧嘩、仲直りなど関係の節目が画像から明確に確認できる場合だけtimelineEvent.shouldRecordをtrueにし、個人情報や会話本文を含めない短い出来事としてまとめてください。通常の会話ならfalseにしてください。

次の形式のみを返してください：{"affection":0,"intentConsistency":0,"relationshipTrend":"rising|stable|falling","progressRisk":0,"scoreReasons":{"affection":"","intentConsistency":"","relationshipTrend":"","progressRisk":""},"summary":"","currentPsychology":"","overallReason":"","evidence":[""],"keyMoments":[{"quote":"","interpretation":""}],"actions":["","", ""],"nextBestMove":"","timelineEvent":{"shouldRecord":false,"eventType":"custom","title":"","note":""}}`;
}

async function analyzeForWeb({ imageBuffer, mimeType, mode, locale = "ja" }) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_NOT_CONFIGURED");
  const startedAt = Date.now();
  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt(mode, locale) },
        {
          role: "user",
          content: [
            { type: "text", text: mode === "reply" ? "この会話に対する次の返信を作ってください。" : "この会話の関係性を分析してください。" },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBuffer.toString("base64")}` } }
          ]
        }
      ],
      temperature: 0.35,
      max_tokens: mode === "reply" ? 700 : 1400,
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
