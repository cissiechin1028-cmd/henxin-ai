# RenAI Web App API

Backend API for the RenAI Web App. It provides Supabase-authenticated analysis,
relationship timelines and reports, plus Stripe subscription endpoints.

Run with `npm start`. The service expects Supabase, OpenAI, Stripe and allowed
Web App origin environment values. Uploaded analysis images are processed in
memory and are not persisted.
