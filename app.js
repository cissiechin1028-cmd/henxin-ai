require("dotenv").config();
const express = require("express");

const {
  getUser,
  addHistory,
  getHistory,
  increaseFreeCount,
  getFreeCount,
  setPaid,
} = require("./userStore");

const { generateReply } = require("./services/openai");
const { replyMessage } = require("./services/line");
const { buildPrompt } = require("./utils/prompt");
const { postprocessReply } = require("./utils/postprocess");

const app = express();
app.use(express.json());

// ===== 测试白名单 =====
const TEST_USER_IDS = (process.env.TEST_USER_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function isTestUser(userId) {
  return TEST_USER_IDS.includes(userId);
}

// =========================
// 短输入分类
// =========================
function classifyShortInput(text) {
  const s = (text || "").trim();

  const greetingList = [
    "おはよう",
    "おはよ",
    "こんにちは",
    "こんばんは",
    "お疲れ様",
    "お疲れ様です",
    "やっほー",
    "もしもし",
  ];

  const thanksList = [
    "ありがとう",
    "ありがと",
    "ありがとうございます",
    "助かる",
    "助かります",
    "嬉しい",
    "うれしい",
  ];

  const sorryList = [
    "ごめん",
    "ごめんね",
    "すみません",
    "ごめんよ",
    "申し訳ない",
    "申し訳ありません",
  ];

  const reactionList = [
    "うん",
    "ううん",
    "そうだね",
    "そうなんだ",
    "了解",
    "りょ",
    "OK",
    "ok",
    "笑",
    "w",
    "なるほど",
    "たしかに",
    "へえ",
    "そう",
  ];

  const questionList = [
    "？",
    "?",
    "返事まだ？",
    "なんで？",
    "どうして？",
    "なんで",
    "どうして",
  ];

  if (greetingList.includes(s)) return "greeting";
  if (thanksList.includes(s)) return "thanks";
  if (sorryList.includes(s)) return "sorry";
  if (reactionList.includes(s)) return "reaction";
  if (questionList.includes(s)) return "question";

  if (s.length <= 8 && !s.includes(" ") && !s.includes("\n")) {
    return "reaction";
  }

  return null;
}

function buildShortInputPrompt(userMessage, shortType) {
  const baseRule = `
あなたは日本人向けの恋愛返信代写AIです。
以下は短い単発メッセージです。
重く考えすぎず、自然なLINE返信を3つ作ってください。

共通条件：
・短文
・自然
・やりすぎない
・意味を勝手に広げすぎない
・相手がそのまま送りやすい文にする
・日本人同士のLINEとして不自然にしない
`;

  const typeRuleMap = {
    greeting: `
種類：挨拶
ルール：
・挨拶として自然に返す
・朝 / 昼 / 夜 / 労い の空気を壊さない
・重くしない
・会話を少し続けやすい案を1つ入れてよい
`,
    thanks: `
種類：感謝
ルール：
・感謝を受けた時に自然に返せる文にする
・大げさにしない
・やさしく受ける
・「こちらこそ」系も可
`,
    sorry: `
種類：謝罪
ルール：
・責めない
・受け止める
・重くしすぎない
・必要なら少し安心させる
`,
    reaction: `
種類：短い反応・相づち
ルール：
・意味を広げすぎない
・軽く自然に返す
・相手が続けやすい案を1つ入れてよい
`,
    question: `
種類：短い疑問・催促
ルール：
・責めすぎない
・重くしない
・不安や圧を強くしない
・自然に返せる文にする
`,
  };

  return `
${baseRule}

${typeRuleMap[shortType] || ""}

入力：
${userMessage}

出力形式：
① ...
② ...
③ ...

⭐おすすめ：○
理由：...
送信タイミング：...
`;
}

function groupTextEvents(events = []) {
  const result = [];

  for (const event of events) {
    if (event.type !== "message") continue;
    if (event.message?.type !== "text") continue;

    const userId = event.source?.userId;
    const text = (event.message?.text || "").trim();

    if (!userId || !text) continue;

    const last = result[result.length - 1];

    if (last && last.userId === userId) {
      last.messages.push(text);
      last.replyToken = event.replyToken;
    } else {
      result.push({
        userId,
        replyToken: event.replyToken,
        messages: [text],
      });
    }
  }

  return result;
}

app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events || [];
    const groupedEvents = groupTextEvents(events);

    for (const item of groupedEvents) {
      const { userId, replyToken, messages } = item;
      const userMessage = messages.join("\n").trim();

      const user = getUser(userId);
      const testUser = isTestUser(userId);

      if (userMessage === "解锁") {
        setPaid(userId, true);
        await replyMessage(
          replyToken,
          "プレミアムプランが有効になりました（無制限利用可能）"
        );
        continue;
      }

      if (!testUser && !user.isPaid && getFreeCount(userId) >= 3) {
        await replyMessage(
          replyToken,
          "本日の無料回数（3回）が終了しました。\n明日また3回使えます。\nプレミアムプランなら無制限で利用できます。"
        );
        continue;
      }

      if (!testUser) {
        increaseFreeCount(userId);
      }

      addHistory(userId, `ユーザー: ${userMessage}`);
      const history = getHistory(userId);

      let prompt = "";
      const shortType = classifyShortInput(userMessage);

      if (shortType) {
        prompt = buildShortInputPrompt(userMessage, shortType);
      } else {
        prompt = buildPrompt({
          relationship: user.relationship,
          purpose: user.purpose,
          history,
          userMessage,
        });
      }

      const rawAiText = await generateReply(prompt);
      const aiText = postprocessReply(rawAiText, userMessage, history);

      addHistory(userId, `AI: ${aiText}`);
      await replyMessage(replyToken, aiText);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("ERROR:", err.response?.data || err.message);
    return res.sendStatus(500);
  }
});

app.get("/", (req, res) => {
  res.send("henxin-ai running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
