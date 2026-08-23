const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

test("Capacitor local bundle origins are explicit CORS allow-list entries", () => {
  const source = fs.readFileSync("webApp.js", "utf8");
  assert.match(source, /"capacitor:\/\/localhost"/);
  assert.match(source, /"http:\/\/localhost"/);
  assert.match(source, /allowedOrigins\.includes\(origin\)/);
});
