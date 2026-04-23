require("dotenv").config();
const express = require("express");

const {
  getUser,
  addHistory,
  getHistory,
  setPaid,
} = require("./userStore");

const { generateReply } = require("./services/openai");
const { replyMessage } = require("./services/line");
const { buildPrompt } = require("./utils/prompt");
const { postprocessReply } = require("./utils/postprocess");

const app = express();
app.use(express.json());

/**
 * ===== 只识别“入口闲聊” =====
 * ⚠️ 不再用长度判断
 * ⚠️ 不再误伤“最近冷たい”等情况输入
 */
function classifyShortInput(text) {
  const s = (text || "").trim();

  // 纯打招呼
  if (["おはよう", "おはよ", "こんにちは", "こんばんは"].includes(s)) {
    return "greeting";
  }

  // 简单感谢
  if (["ありがとう", "ありがと", "ありがとうございます"].includes(s)) {
    return "thanks";
  }

  // 简单道歉
  if (["ごめん", "ごめんね", "すみません"].includes(s)) {
    return "sorry";
  }

  // 极短反应
  if (["うん", "了解", "OK", "ok", "笑", "w"].includes(s)) {
    return "reaction";
  }

  return null;
}

/**
 * ===== 入口引导（只用于打招呼）=====
 */
function buildShortInputPrompt(userMessage, type) {
  if (type === "greeting") {
    return `
あなたは恋愛LINE返信サポートAIです。

挨拶に自然に返しつつ、
「相手とのやり取りを送れば返信を考えられる」ことを
さりげなく伝えてください。

条件：
・1〜2文
・自然
・営業っぽくしない
・軽く導線を出すだけ

入力：
${userMessage}

出力：
返信文1つだけ
`;
  }

  if (type === "thanks") {
    return `
感謝への自然な一言返信を作る。

入力：
${userMessage}

出力：
返信文1つ
`;
  }

  if (type === "sorry") {
    return `
謝罪への自然な受け止め返信を作る。

入力：
${userMessage}

出力：
返信文1つ
`;
  }

  if (type === "reaction") {
    return `
短い相づちへの自然な返しを作る。

入力：
${userMessage}

出力：
返信文1つ
`;
  }

  return null;
}

/**
 * ===== webhook =====
 */
app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events || [];

    for (const event of events) {
      if (event.type !== "message") continue;
      if (event.message.type !== "text") continue;

      const userId = event.source.userId;
      const userMessage = event.message.text.trim();

      const user = getUser(userId);

      // ===== 测试用解锁 =====
      if (userMessage === "解锁") {
        setPaid(userId, true);

        await replyMessage(
          event.replyToken,
          "プレミアムプランが有効になりました（無制限利用可能）"
        );
        continue;
      }

      // ===== 记录历史 =====
      addHistory(userId, `ユーザー: ${userMessage}`);
      const history = getHistory(userId);

      let prompt = "";

      // ===== 判断是否入口闲聊 =====
      const shortType = classifyShortInput(userMessage);

      if (shortType) {
        // 👉 仅打招呼走这里
        prompt = buildShortInputPrompt(userMessage, shortType);
      } else {
        // 👉 所有真实需求全部走主Prompt
        prompt = buildPrompt({
          relationship: user.relationship,
          purpose: user.purpose,
          history,
          userMessage,
        });
      }

      // ===== 调用AI =====
      const raw = await generateReply(prompt);

      // ===== 后处理（推荐/时机修正）=====
      const final = postprocessReply(raw, userMessage, history);

      // ===== 存储AI回复 =====
      addHistory(userId, `AI: ${final}`);

      // ===== 回复用户 =====
      await replyMessage(event.replyToken, final);
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
