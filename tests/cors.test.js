const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("CORS permits every RenAI anonymous identity header", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "webApp.js"), "utf8");
  const match = source.match(/setHeader\("Access-Control-Allow-Headers",\s*"([^"]+)"\)/);
  assert.ok(match, "Access-Control-Allow-Headers must be configured");
  const allowed = new Set(match[1].split(",").map(value => value.trim().toLowerCase()));
  for (const header of ["X-RenAI-Device-ID", "X-RenAI-Tracking-ID", "X-RenAI-Fingerprint"]) {
    assert.ok(allowed.has(header.toLowerCase()), `${header} must be allowed by CORS`);
  }
});
