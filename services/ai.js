const axios = require("axios");
const { buildPrompt, formatFreeReply } = require("./promptBuilder");

async function generateAIResponse({ input, userState }) {
  // 👇 必须最先拦截「続き」，不要进入 buildPrompt
  if (input === "続き" || input === "つづき") {
    return await generateProDirect(userState);
  }

  const prompt = buildPrompt({ input, userState });

  try {
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: `
あなたは恋愛LINE返信の専門家です。

ルール：
・日本語のみ
・中国語は禁止
・Pro、プレミアム、有料、課金という言葉は禁止
・長文禁止
・一般論禁止
・説教禁止
・自然な日本語
・判断を必ず入れる
・優しいだけの回答は禁止
・テンプレートの使い回しは禁止

重要：
・ユーザープロンプトの出力形式を最優先する
・入力タイプに従う
・相手を責めない
・追いすぎない
・卑屈にならない
・でも避雷点ははっきり言う
`
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.65,
        max_tokens: 800
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const aiResponse = res.data.choices[0].message.content.trim();

    // FreeはPro部分を隠す
    return formatFreeReply(aiResponse);
  } catch (err) {
    console.error("OPENAI ERROR:", err.response?.data || err.message);

    return `【結論】
今は、無理に踏み込むと相手がさらに距離を置きやすい状態です。

---

送るなら👇

A（安全）
「無理しないでね。落ち着いたらまた話そう」

B（少し攻める）
「今は無理に聞かないけど、落ち着いたら少しだけ話せたら嬉しい」

---

⚠️ 注意
ここで理由を聞いたり追いかけると、相手がさらに離れやすいです。

---

※この先の流れと本音を見るには「続き」と送ってください`;
  }
}

async function generateProDirect(userState) {
  const context = userState?.context || {};

  const prompt = `
ユーザーは直前のやり取りの「続き」を求めています。

前回までの文脈：
・前回の入力タイプ：${context.lastInputType || "なし"}
・前回のシナリオ：${context.lastScenario || "なし"}
・前回の相手LINE：${context.lastPartnerMessage || "なし"}
・前回の状況説明：${context.lastSituation || "なし"}
・ユーザーの目的：${context.userGoal || "なし"}
・前回のアドバイス：${context.lastAdvice || "なし"}

【タスク】
・直前の内容を前提にする
・①②などの確認質問は絶対にしない
・Free部分を繰り返さない
・すぐに続きを出す
・日本語だけで答える
・長くしすぎない
・一般論ではなく、この場面の判断を書く

【出力形式】

【本音】
相手は今、〇〇の可能性が高いです。

【この後どうする？】
・〇〇する
・〇〇はまだしない
・〇〇のタイミングで送る

【やりがちNG】
ここで〇〇すると、〇〇になりやすいです。
`;

  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `
あなたは恋愛LINE返信の専門家です。

ルール：
・日本語のみ
・中国語は禁止
・確認質問は禁止
・①②を聞かない
・Pro、プレミアム、有料、課金という言葉は禁止
・一般論禁止
・説教禁止
・短く具体的に
・相手の心理を決めつけすぎない
・でも曖昧に逃げない
`
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.65,
      max_tokens: 500
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  return res.data.choices[0].message.content.trim();
}

module.exports = { generateAIResponse };
