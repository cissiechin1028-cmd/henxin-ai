const axios = require("axios");

function safeParseJson(text = "") {
  try {
    const cleaned = String(text)
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    return JSON.parse(cleaned);
  } catch (err) {
    return null;
  }
}

function normalizeClassification(data = {}) {
  const inputTypeList = ["partner", "situation", "followup", "unknown"];
  const scenarioList = [
    "normal",
    "cheating",
    "breakup",
    "ignore",
    "cold",
    "flirt",
    "reunion",
    "fight"
  ];
  const actionList = [
    "wait",
    "soft_reply",
    "reduce_pressure",
    "cool_down",
    "observe",
    ""
  ];
  const riskList = [
    "push_too_hard",
    "pressure",
    "escalation",
    "begging",
    "accusation",
    ""
  ];

  const inputType = inputTypeList.includes(data.inputType)
    ? data.inputType
    : "situation";

  const scenario = scenarioList.includes(data.scenario)
    ? data.scenario
    : "normal";

  const recommendedAction = actionList.includes(data.recommendedAction)
    ? data.recommendedAction
    : "";

  const mainRisk = riskList.includes(data.mainRisk)
    ? data.mainRisk
    : "";

  let riskLevel = Number(data.riskLevel);
  if (!Number.isFinite(riskLevel)) riskLevel = 1;
  riskLevel = Math.max(1, Math.min(4, riskLevel));

  return {
    inputType,
    scenario,
    contactAllowed: Boolean(data.contactAllowed),
    recommendedAction,
    mainRisk,
    riskLevel
  };
}

async function classifyMessage({ input, user }) {
  try {
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: `
あなたは恋愛LINE相談の分類AIです。
返信文は作らず、分類だけを行ってください。
必ずJSONだけを返してください。
日本語の説明文は禁止です。

分類項目：
- inputType: partner / situation / followup / unknown
- scenario: normal / cheating / breakup / ignore / cold / flirt / reunion / fight
- contactAllowed: true / false
- recommendedAction: wait / soft_reply / reduce_pressure / cool_down / observe / ""
- mainRisk: push_too_hard / pressure / escalation / begging / accusation / ""
- riskLevel: 1 / 2 / 3 / 4

判断基準：
partner = 相手から来たLINEそのもの
situation = ユーザーの状況説明
followup = 前回相談の続き
unknown = 情報が短すぎて不明

scenario:
cheating = 浮気疑い、他の異性、隠し事
breakup = 別れ話、振られた、連絡拒否
reunion = 復縁、元彼、元カノ、やり直し
fight = 喧嘩、怒らせた、謝りたい、仲直り
ignore = 既読無視、未読無視、返事がない
cold = 冷たい、そっけない、返信が遅い、距離を感じる
flirt = 片思い、告白、デート、脈あり脈なし
normal = その他

riskLevel:
1 = 通常
2 = 返信遅い、冷たい、既読無視など軽〜中リスク
3 = 復縁、浮気疑い、喧嘩、強い不安など高リスク
4 = 別れ話、連絡拒否、明確な拒絶など最重要リスク

注意：
・断定しすぎない
・ユーザーの不安を煽らない
・ただし危険な追いLINEや問い詰めは避ける判断にする
`
          },
          {
            role: "user",
            content: `
ユーザー入力：
${input}

前回情報：
lastInput: ${user?.lastInput || ""}
lastInputType: ${user?.lastInputType || ""}
lastScenario: ${user?.lastScenario || ""}
recommendedAction: ${user?.recommendedAction || ""}
mainRisk: ${user?.mainRisk || ""}
`
          }
        ],
        temperature: 0,
        max_tokens: 300
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const text = res.data.choices[0].message.content.trim();
    const parsed = safeParseJson(text);

    if (!parsed) return null;

    return normalizeClassification(parsed);
  } catch (err) {
    console.error("CLASSIFIER ERROR:", err.response?.data || err.message);
    return null;
  }
}

module.exports = { classifyMessage };
