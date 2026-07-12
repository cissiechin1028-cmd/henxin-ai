# henxin-ai
LINE webhook server
# RenAI backend

The original LINE entry point remains in `app.js` for reference. The Web App
uses the separate `webApp.js` entry point and does not call LINE messaging or
webhook code.

Run the Web API with `npm run start:web`. It expects Supabase, OpenAI and Web
App origin environment values. Browser requests must provide a valid Supabase
access token. Analysis images are processed in memory and are not persisted.
