require("dotenv").config();

const express = require("express");
const Stripe = require("stripe");
const { replyMessage, replyButton } = require("./services/line");
const { handleMessage } = require("./messageHandler");
const { updateUser } = require("./userStore");

const app = express();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const BASE_URL = process.env.BASE_URL || "";
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

app.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    let event;

    try {
      const signature = req.headers["stripe-signature"];

      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("STRIPE WEBHOOK VERIFY ERROR:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const userId = session.metadata?.userId || session.client_reference_id;

        if (userId) {
          await updateUser(userId, {
            plan: "pro"
          });

          console.log("STRIPE PLAN UPDATED TO PRO:", userId);
        } else {
          console.error("STRIPE WEBHOOK NO USER ID");
        }
      }

      res.status(200).send("OK");
    } catch (err) {
      console.error("STRIPE WEBHOOK HANDLE ERROR:", err.message);
      res.status(200).send("OK");
    }
  }
);

app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).send("henxin-ai is running");
});

app.get("/success", (req, res) => {
  res.status(200).send(`
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>お支払い完了</title>
<style>
  body {
    margin: 0;
    padding: 0;
    background: linear-gradient(180deg, #f8fbff 0%, #eef4ff 100%);
    font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
    color: #1f2937;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
  }

  .card {
    width: 90%;
    max-width: 420px;
    background: #ffffff;
    border-radius: 24px;
    padding: 48px 32px;
    box-sizing: border-box;
    box-shadow: 0 20px 60px rgba(15, 23, 42, 0.08);
    text-align: center;
  }

  .icon {
    width: 88px;
    height: 88px;
    margin: 0 auto 28px;
    border-radius: 50%;
    background: linear-gradient(135deg, #22c55e, #16a34a);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 42px;
    color: #ffffff;
    box-shadow: 0 12px 30px rgba(34, 197, 94, 0.25);
  }

  h1 {
    margin: 0 0 16px;
    font-size: 28px;
    font-weight: 700;
    color: #111827;
    letter-spacing: 0.02em;
  }

  .subtitle {
    font-size: 15px;
    line-height: 1.75;
    color: #4b5563;
    margin-bottom: 30px;
  }

  .badge {
    display: inline-block;
    padding: 10px 18px;
    background: #eefbf3;
    color: #16a34a;
    border-radius: 999px;
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 32px;
  }

  .button {
    display: inline-block;
    width: 100%;
    box-sizing: border-box;
    padding: 16px 24px;
    background: linear-gradient(135deg, #4f46e5, #6366f1);
    color: #ffffff;
    text-decoration: none;
    border-radius: 14px;
    font-size: 16px;
    font-weight: 700;
    box-shadow: 0 12px 24px rgba(79, 70, 229, 0.20);
  }

  .note {
    margin-top: 18px;
    font-size: 13px;
    color: #9ca3af;
    line-height: 1.8;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">✓</div>

    <div class="badge">恋愛返信AI Pro が有効になりました</div>

    <h1>お支払い完了</h1>

    <div class="subtitle">
      ご購入ありがとうございます。<br>
      LINEに戻って、もう一度メッセージを送ると<br>
      Pro分析をご利用いただけます。
    </div>

    <a href="https://line.me/R/" class="button">
      LINEに戻る
    </a>

    <div class="note">
      もしLINEが開かない場合は、<br>
      この画面を閉じて手動でLINEに戻ってください。
    </div>
  </div>
</body>
</html>
  `);
});

app.get("/cancel", (req, res) => {
  res.status(200).send("お支払いはキャンセルされました。");
});

app.get("/checkout", async (req, res) => {
  try {
    const userId = String(req.query.userId || "").trim();

    if (!userId) {
      return res.status(400).send("userId is required");
    }

    if (!BASE_URL || !STRIPE_PRICE_ID) {
      return res.status(500).send("Stripe checkout is not configured");
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: STRIPE_PRICE_ID,
          quantity: 1
        }
      ],
      success_url: `${BASE_URL}/success`,
      cancel_url: `${BASE_URL}/cancel`,

      locale: "ja",   // 强制 Stripe Checkout 显示日语

      client_reference_id: userId,
      metadata: {
        userId
      },
      subscription_data: {
        metadata: {
          userId
        }
      }
    });

    res.redirect(303, session.url);
  } catch (err) {
    console.error("STRIPE CHECKOUT ERROR:", err.message);
    res.status(500).send("Checkout error");
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events || [];

    for (const event of events) {
      if (event.type !== "message") continue;
      if (!event.message || event.message.type !== "text") continue;

      const userId = event.source?.userId;
      const replyToken = event.replyToken;
      const text = event.message.text;

      if (!userId || !replyToken || !text) continue;

      const replyText = await handleMessage(userId, text);

      const checkoutUrlMatch = String(replyText).match(
        /https:\/\/henxin-ai\.onrender\.com\/checkout\?userId=[^\s]+/
      );

      if (checkoutUrlMatch) {
        const checkoutUrl = checkoutUrlMatch[0];

        const cleanedReplyText = String(replyText)
          .replace(
            /\n*続きを見る👇\n*https:\/\/henxin-ai\.onrender\.com\/checkout\?userId=[^\s]+/g,
            ""
          )
          .trim();

        await replyButton(
          replyToken,
          cleanedReplyText,
          "今すぐ続きを見る",
          checkoutUrl
        );
      } else {
        await replyMessage(replyToken, replyText);
      }
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("WEBHOOK ERROR:", err.response?.data || err.message);
    res.status(200).send("OK");
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
