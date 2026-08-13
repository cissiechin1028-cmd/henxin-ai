# RenAI Web App API

Backend API for the RenAI Web App. It provides Supabase-authenticated analysis,
relationship timelines and reports, plus Stripe subscription endpoints.

Run with `npm start`. The service expects Supabase, OpenAI, Stripe and allowed
Web App origin environment values. Uploaded analysis images are processed in
memory and are not persisted.

Screenshot-to-chat extraction limits are configurable without a code change:

- `CHAT_EXTRACTION_ANONYMOUS_DAILY_LIMIT` (default `3`)
- `CHAT_EXTRACTION_FREE_DAILY_LIMIT` (default `3`)
- `CHAT_EXTRACTION_PRO_DAILY_LIMIT` (default `10`)

Cache hits do not consume these limits. `OPENAI_EXTRACTION_MODEL` can select a
lower-cost vision model independently from the main analysis model.

Paid AI consultation uses `OPENAI_CONSULTATION_MODEL` (falling back to the
vision model) and consumes `AI_USAGE_CONSULTATION_UNITS` per successful reply
(default `25`) from the existing monthly Pro Fair Use budget. Successful AI
consultation replies also have a separate monthly cap controlled by
`PRO_CONSULTATION_MONTHLY_LIMIT` (default `30`).

Paid subscriptions use two Stripe prices:

- `STRIPE_LITE_PRICE_ID`: RenAI Lite, JPY 680/month
- `STRIPE_PREMIUM_PRICE_ID`: RenAI Premium, JPY 1,280/month
- `STRIPE_US_LITE_PRICE_ID`: RenAI Lite, USD 6.99/month
- `STRIPE_US_PREMIUM_PRICE_ID`: RenAI Premium, USD 12.99/month
- `STRIPE_TW_LITE_PRICE_ID`: RenAI Lite, TWD 169/month
- `STRIPE_TW_PREMIUM_PRICE_ID`: RenAI Premium, TWD 329/month
- `STRIPE_HK_LITE_PRICE_ID`: RenAI Lite, HKD 42/month
- `STRIPE_HK_PREMIUM_PRICE_ID`: RenAI Premium, HKD 82/month

Checkout requires the Price ID for the selected market and verifies its Stripe
currency, monthly interval, and unit amount before creating a subscription. It
never falls back to a Japanese Price for US, TW, or HK.

The legacy `STRIPE_PRICE_ID` remains a Premium fallback during migration. Lite
receives 50 reply proposals, 10 combined chat-analysis/consultation uses and 10
strategy uses per UTC month. Premium receives 150, 30 and 30 respectively.
