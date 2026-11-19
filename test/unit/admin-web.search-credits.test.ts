import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../apps/admin-web/package.json", import.meta.url));
const { buildSync } = require("esbuild");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
function load(path: string) {
  const compiled = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
  const module = { exports: {} as any };
  new Function("require", "module", "exports", compiled)(require, module, module.exports);
  return module.exports;
}

test("search settings renders the versioned price input", () => {
  const route = load("apps/admin-web/app/routes/ainovel-web-search.tsx").default;
  const html = renderToStaticMarkup(createElement(route));
  assert.match(html, /每次搜索创作点/);
  assert.match(html, /id="pointsPerSearch"/);
});

test("search records distinguish charged, replayed and legacy missing billing data", () => {
  const { SearchRecordsTable } = load("apps/admin-web/app/components/search-records-table.tsx");
  const base = { userId: "u", sceneKey: "write_turn", timestamp: "2026-11-19", status: "completed", upstreamCalls: 1 };
  const html = renderToStaticMarkup(createElement(SearchRecordsTable, { records: [
    { ...base, requestId: "paid", chargedPoints: 2, billingStatus: "charged" },
    { ...base, requestId: "retry", chargedPoints: 0, billingStatus: "replayed" },
    { ...base, requestId: "historical" },
  ] }));
  assert.match(html, /扣除创作点/);
  assert.match(html, /charged/);
  assert.match(html, /replayed/);
  assert.match(html, /—/);
});
