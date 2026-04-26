require("dotenv").config();
const express = require("express");

const {
  getUser,
  addHistory,
  getHistory,
  setPaid,
  setPlan,
  incrementUsage,
  incrementCriticalUsage,
  resetUser,
} = require("./userStore");

const { generateReply } = require("./services/openai");
const { replyMessage } = require("./services/line");
const { buildPrompt } = require("./utils/prompt");
const { postprocessReply } = require("./utils/postprocess");

const app = express();
app.use(express.json());

function classifyGreeting(text) {
  const s = (text || "").trim();
  return ["おはよう", "おはよ", "こんにちは", "こんばんは", "お疲れ様", "お疲れ様です"].includes(s);
}

function detectUserStyle(userMessage) {
  const text = userMessage || "";
  if (/既読無視|未読|返事来ない|冷たい|そっけない|無視/.test(text)) return "soft";
  if (/不安|怖い|迷って|送っていい|重いかな|大丈夫かな/.test(text)) return "soft";
  if (/会いたい|誘いたい|ご飯行きたい|進めたい/.test(text)) return "push";
  return "balance";
}

function detectReconciliation(userMessage) {
  const text = userMessage || "";
  return /復縁|元カレ|元カノ|やり直したい|振られた|別れた|もう一度|取り戻したい|別れ話|もう無理|会わない|終わり/.test(text);
}

function isCriticalCase(text) {
  return detectReconciliation(text || "");
}

function isTestUser(userId) {
  const ids = (process.env.TEST_USER_IDS || "").split(",").map((v) => v.trim());
  return ids.includes(userId);
}

function trimToFreeVersion(text) {
  if (!text) return "";

  let result = "";
  const hasConclusion = text.includes("【結論】");
  const hasReason = text.includes("【理由】");

  if (hasConclusion && hasReason) {
    const afterConclusion = text.split("【結論】")[1];
    const parts = afterConclusion.split("【理由】");

    const conclusion = parts[0].trim();
    let reason = parts[1] ? parts[1].trim() : "";

    const stopPoints = [
      "【⚠️",
      "【他の選択肢】",
      "【今の最適な行動】",
      "【⭐",
      "⭐",
      "⚠️",
      "他の選択肢",
      "送信タイミング",
      "タイミング",
    ];

    for (const point of stopPoints) {
      if (reason.includes(point)) {
        reason = reason.split(point)[0].trim();
      }
    }

    result = `【結論】
${conclusion}

【理由】
${reason}`;
  } else {
    result = text.split("──────────")[0].trim();
  }

  return `${result}

──────────

無料版ではここまで表示しています。

プレミアムでは👇
・やりがちNG
・他の選択肢
・送るタイミング
・関係が悪化しやすいポイント

まで詳しく見られます。`;
}

function buildFreeLimitMessage() {
  return `無料分はすでにご利用済みです。

このまま自己判断で送ると、
一言で距離が広がることもあります。

プレミアムでは👇
・無制限で返信作成
・NG回避
・送る/送らない判断
・タイミング判断

まで使えます。`;
}

function buildCriticalPreviewMessage() {
  return `この状況はかなり重要な分岐です。

【結論】
👉 今はすぐに戻ろうとせず、軽く様子を見るのが一番安全

【理由】
相手は今、気持ちを整理している可能性があります。
ここで踏み込むと、負担に感じて距離が固定されるリスクがあります。

【今の一番安全な返し】
「久しぶりだね、元気にしてる？」

──────────

このケースは一言で結果が変わる可能性があります。

より安全な返し・送るタイミング・NG回避は
復縁PROで詳しく見られます。`;
}

function buildCriticalLockedMessage() {
  return `このケースは通常のLINE返信とは違い、
タイミング・言い方・距離感で結果が大きく変わります。

ここから先の詳しい判断は
復縁PROで対応しています。

復縁PROでは👇
・送るべきか / 待つべきか
・最適なタイミング
・距離の詰め方
・絶対NG
・相手の返信別の次の一手

まで判断できます。`;
}

function buildGreetingPrompt(userMessage) {
  return `
あなたは恋愛LINE返信サポートAIです。

ユーザーの挨拶に自然に返しつつ、
「相手とのLINE内容」または「今の状況」を送れば返信を一緒に考えられることを伝えてください。

条件：
・1〜2文
・自然
・営業っぽくしない
・①②③を出さない
・おすすめ、理由、送信タイミングを出さない
・返信文1つだけ

入力：
${userMessage}

出力：
`;
}

app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events || [];

    for (const event of events) {
      if (event.type === "follow") {
        await replyMessage(event.replyToken, `そのLINE、このまま送ると失敗するかも。

ちょっとした一言で、
距離が一気にズレることもある。

ここで👇
✔ 今送るべきか判断
✔ 一番安全な返しを作る

やることは1つだけ👇
相手のメッセージ、そのまま送って

（コピペ・スクショOK）

そのまま送れる形で出すから、
考えなくて大丈夫。`);
        continue;
      }

      if (event.type !== "message") continue;
      if (event.message.type !== "text") continue;

      const userId = event.source.userId;
      const userMessage = event.message.text.trim();
      const user = getUser(userId);
      const plan = user.plan || "free";

      if (userMessage.toLowerCase() === "reset" && isTestUser(userId)) {
        resetUser(userId);
        await replyMessage(event.replyToken, "テスト用リセット完了しました。");
        continue;
      }

      if (userMessage === "解锁" || userMessage.toLowerCase() === "premium") {
        setPaid(userId, true);
        setPlan(userId, "premium");
        await replyMessage(event.replyToken, "プレミアムプランが有効になりました");
        continue;
      }

      if (userMessage.toLowerCase() === "pro") {
        setPaid(userId, true);
        setPlan(userId, "pro");
        await replyMessage(event.replyToken, "復縁PROプランが有効になりました");
        continue;
      }

      const isGreeting = classifyGreeting(userMessage);
      const isReconciliation = detectReconciliation(userMessage);
      const isCritical = isCriticalCase(userMessage);

      if (isCritical && plan !== "pro") {
        const criticalUsage = Number(user.criticalUsageCount || 0);

        if (criticalUsage >= 1) {
          await replyMessage(event.replyToken, buildCriticalLockedMessage());
          continue;
        }

        incrementCriticalUsage(userId);
        await replyMessage(event.replyToken, buildCriticalPreviewMessage());
        continue;
      }

      const usageCount = Number(user.usageCount || user.count || 0);

      if (plan === "free" && usageCount >= 3 && !isGreeting) {
        await replyMessage(event.replyToken, buildFreeLimitMessage());
        continue;
      }

      let final = "";

      if (isGreeting) {
        const raw = await generateReply(buildGreetingPrompt(userMessage));
        final = raw.trim();
      } else {
        addHistory(userId, `ユーザー: ${userMessage}`);
        const history = getHistory(userId);
        const style = detectUserStyle(userMessage);

        const prompt = buildPrompt({
          relationship: user.relationship,
          purpose: user.purpose,
          history,
          userMessage,
          style,
          plan,
          isReconciliation,
          isCritical,
        });

        const raw = await generateReply(prompt);
        final = postprocessReply(raw);

        addHistory(userId, `AI: ${final}`);
      }

      if (plan === "free" && !isGreeting) {
        incrementUsage(userId);
        final = trimToFreeVersion(final);
      }

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
