const axios = require("axios");

function safeParseJson(text = "") {
  try {
    const cleaned = String(text || "")
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    return JSON.parse(cleaned);
  } catch (err) {
    return null;
  }
}

function cleanText(text = "") {
  return String(text || "")
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildModeInstruction(entryMode = "reply") {
  if (entryMode === "mind") {
    return `
目的：
LINEスクショから直近の会話を読み取り、相手の本音・温度感・脈あり/脈なし感を短く見ます。

replyのルール：
・日本語のみ
・返信文を主役にしない
・無理に「こう返す」を出さない
・相手の気持ちは断定しない
・でも、どう見えやすいかは短く判断する
・本音、温度感、脈あり/脈なし感を自然な文章で伝える
・見出し禁止
・箇条書き禁止
・説明は長くしない
`;
  }

  if (entryMode === "consult") {
    return `
目的：
LINEスクショから直近の状況を読み取り、今どう動くべきかを短く整理します。

replyのルール：
・日本語のみ
・返信文だけに寄せすぎない
・状況整理と次の行動を優先する
・相手の気持ちは断定しない
・でも、今の流れがどう見えやすいかは短く判断する
・見出し禁止
・箇条書き禁止
・説明は長くしない
`;
  }

  return `
目的：
LINEスクショから直近の会話を読み取り、次に送ると自然な一言を提案します。

replyのルール：
・日本語のみ
・まず次に送る一言を出す
・送るLINEは必ず「」で囲む
・「」の中に絵文字は入れない
・説明は1〜2文だけ
・見出し禁止
・箇条書き禁止
・相手の気持ちは断定しない
・でも、次にどう返すのが自然かは判断する
`;
}

async function analyzeLineScreenshot(imageBuffer, entryMode = "reply") {
  try {
    const base64Image = Buffer.from(imageBuffer).toString("base64");

    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: `
あなたはLINEスクショを読むAIです。
必ずJSONだけを返してください。説明文は禁止です。

LINEスクショの読み方：
・基本的に左側の吹き出し = 相手
・右側の吹き出し = ユーザー
・直近の5〜10通を中心に見る
・長い履歴を全部まとめようとしない
・読めない部分は無理に補完しない
・スタンプだけの場合は「内容不明」と扱う
・最後の相手の発言、または会話の最後の流れを重視する

現在の入口:
${entryMode}

${buildModeInstruction(entryMode)}

返すJSON形式：
{
  "success": true,
  "chatContext": "相手：...\\n私：...\\n相手：...",
  "reply": "ユーザーに返す文章"
}

スクショが読めない場合：
{
  "success": false,
  "chatContext": "",
  "reply": "画像の内容をうまく読み取れませんでした。相手から来たLINEか、直近のやり取りをテキストで送ってください。"
}
`
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "このLINEスクショを読んで、現在の入口に合わせてJSONで返してください。"
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`
                }
              }
            ]
          }
        ],
        temperature: 0.35,
        max_tokens: 650
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

    if (!parsed) {
      return {
        success: false,
        chatContext: "",
        reply: "画像の内容をうまく読み取れませんでした。相手から来たLINEか、直近のやり取りをテキストで送ってください。"
      };
    }

    return {
      success: Boolean(parsed.success),
      chatContext: cleanText(parsed.chatContext || ""),
      reply: cleanText(parsed.reply || "")
    };
  } catch (err) {
    console.error("IMAGE ANALYZER ERROR:", err.response?.data || err.message);

    return {
      success: false,
      chatContext: "",
      reply: "画像の内容をうまく読み取れませんでした。相手から来たLINEか、直近のやり取りをテキストで送ってください。"
    };
  }
}

module.exports = {
  analyzeLineScreenshot
};
