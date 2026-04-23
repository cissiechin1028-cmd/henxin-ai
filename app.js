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
 * ===== 自动识别用户风格（最终版）=====
 * 不需要用户输入任何指令
 */
function detectUserStyle(userMessage, history = []) {
  const text = (userMessage || "").toLowerCase();

  // 🔴 强风险场景 → 一律温和
  if (
    /既読無視|未読|返事来ない|冷たい|そっけない|無視/.test(text)
  ) {
    return "soft";
  }

  // 🟡 焦虑 / 犹豫 → 温和
  if (
    /どうしよう|不安|怖い|迷って|送っていい|大丈夫かな|重いかな/.test(text)
  ) {
    return "soft";
  }

  // 🔵 主动推进意图
  if (
    /会いたい|誘いたい|どうやって誘う|行きたい|進めたい/.test(text)
  ) {
    return "push";
  }

  // ⚪ 默认
  return "balance";
}

/**
 * ===== 入口闲聊识别（只保留必要）=====
 */
function classifyShortInput(text) {
  const s = (text || "").trim();

  if (["おはよう", "おはよ", "こんにちは", "こんばんは"].includes(s)) {
    return "greeting";
  }

  return null;
}

/**
 * ===== 入口引导 =====
 */
function buildShortInputPrompt(userMessage) {
  return `
あなたは恋愛LINE返信サポートAIです。

挨拶に自然に返しつつ、
「相手とのやり取りを送れば返信を考えられる」ことを
軽く伝えてください。

条件：
・1〜2文
・自然
・営業っぽくしない

入力：
${userMessage}

出力：
返信文1つ
`;
}

app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events || [];

    for (const event of events) {
      if (event.type !== "message") continue;
      if (event.message.type !== "text") continue;

      const userId = event.source.userId;
      const userMessage = event.message.text.trim();
      const user = getUser(userId);

      // 解锁（测试）
      if (userMessage === "解锁") {
        setPaid(userId, true);
        await replyMessage(
          event.replyToken,
          "プレミアムプランが有効になりました"
        );
        continue;
      }

      addHistory(userId, `ユーザー: ${userMessage}`);
      const history = getHistory(userId);

      const shortType = classifyShortInput(userMessage);

      let prompt = "";

      if (shortType) {
        prompt = buildShortInputPrompt(userMessage);
      } else {
        // 👉 自动风格识别（核心）
        const style = detectUserStyle(userMessage, history);

        prompt = buildPrompt({
          relationship: user.relationship,
          purpose: user.purpose,
          history,
          userMessage,
          style,
        });
      }

      const raw = await generateReply(prompt);
      const final = postprocessReply(raw);

      addHistory(userId, `AI: ${final}`);
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
