const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const test=require("node:test");

const source=fs.readFileSync(path.join(__dirname,"..","webApp.js"),"utf8");

test("relationship deletion is authenticated and owner scoped",()=>{
  assert.match(source,/app\.delete\("\/api\/v1\/relationships\/:relationshipId", requireUser/);
  assert.match(source,/findOwnedRelationship\(req\.user\.id, req\.params\.relationshipId\)/);
  assert.match(source,/from\("relationships"\)\.delete\(\)[\s\S]*\.eq\("id", relationship\.id\)\.eq\("user_id", req\.user\.id\)/);
});

test("relationship deletion removes set-null dependents before cascade delete",()=>{
  const start=source.indexOf('app.delete("/api/v1/relationships/:relationshipId"');
  const end=source.indexOf('app.get("/api/v1/relationships/:relationshipId/events"',start);
  const route=source.slice(start,end);
  assert.match(route,/from\("ai_consultation_threads"\)\.delete\(\)[\s\S]*\.eq\("user_id", req\.user\.id\)\.eq\("relationship_id", relationship\.id\)/);
  assert.match(route,/from\("analyses"\)\.delete\(\)[\s\S]*\.eq\("user_id", req\.user\.id\)\.eq\("relationship_id", relationship\.id\)/);
  assert.ok(route.indexOf('from("analyses")')<route.indexOf('from("relationships")'));
  assert.match(route,/res\.sendStatus\(204\)/);
});
