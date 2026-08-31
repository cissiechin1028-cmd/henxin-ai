const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const source = fs.readFileSync("webApp.js", "utf8");

test("Staging analysis acceptance bypass is exact-service, authenticated, and owner scoped", () => {
  assert.match(source, /const isStagingService = process\.env\.RENDER_SERVICE_NAME === "renai-relationship-sync-staging"/);
  assert.match(source, /isStagingService&&authenticatedUser&&requestedRelationshipId/);
  assert.match(source, /resolveRelationship\(authenticatedUser\.id,requestedRelationshipId\)/);
  assert.match(source, /Boolean\(stagingRelationship\)/);
});

test("Production and unowned relationships cannot receive the Staging acceptance bypass", () => {
  assert.doesNotMatch(source, /NODE_ENV.*staging|RENAI_ENV.*staging/);
  assert.match(source, /if\(resolved\.error\|\|!resolved\.data\)return res\.status/);
  assert.match(source, /else if\(!privileged\).*reserve_anonymous_analysis_credit/);
});
