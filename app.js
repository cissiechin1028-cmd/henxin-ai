require("dotenv").config();

const express = require("express");
const Stripe = require("stripe");
const { replyMessage } = require("./services/line");
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
  res
    .status(200)
    .send("お支払いが完了しました。LINEに戻って、もう一度メッセージを送ってください。");
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

      await replyMessage(replyToken, replyText);
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
