const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

test("Capacitor local bundle origins are explicit CORS allow-list entries", () => {
  const source = fs.readFileSync("webApp.js", "utf8");
  assert.match(source, /"capacitor:\/\/localhost"/);
  assert.match(source, /"http:\/\/localhost"/);
  assert.match(source, /allowedOrigins\.includes\(origin\)/);
  assert.match(source, /Access-Control-Allow-Headers[^\n]+X-RenAI-Request-ID/);
});

test("Remote Preview origin is allowed only by the Staging Render service", () => {
  const source = fs.readFileSync("webApp.js", "utf8");
  assert.match(source, /RENDER_SERVICE_NAME === "renai-relationship-sync-staging"/);
  assert.match(source, /\["http:\/\/localhost:4174"\]/);
  assert.doesNotMatch(source, /Access-Control-Allow-Origin", "\*"/);
});
