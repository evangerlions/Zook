import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const req = createRequire(new URL("../../apps/admin-web/package.json", import.meta.url));
const { buildSync } = req("esbuild"), { createElement } = req("react"), { renderToStaticMarkup } = req("react-dom/server");
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL("../../apps/admin-web/app/components/billing-balance-metrics.tsx", import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", write: false });
const mod = { exports: {} as any }; new Function("require", "module", "exports", bundle.outputFiles[0].text)(req, mod, mod.exports);
const BillingBalanceMetrics = mod.exports.BillingBalanceMetrics;
test("balance widget identifies APP and H5 separately instead of two ambiguous numbers", () => {
  const html = renderToStaticMarkup(createElement(BillingBalanceMetrics, { metrics: [
    { kind: "geyan_app_remaining", remaining: 1430, unit: "次" }, { kind: "geyan_h5_remaining", remaining: 0, unit: "次" },
  ] }));
  assert.match(html, /APP 一键认证：1430 次/); assert.match(html, /H5 一键认证：0 次/);
  assert.match(renderToStaticMarkup(createElement(BillingBalanceMetrics, {})), /—/);
});

test("balance widget displays currency amounts to two decimal places without changing the sample", () => {
  const metrics = [
    { remaining: 22.544710299999906, unit: "USD" },
    { remaining: 127.51546325, unit: "USD" },
    { remaining: 8, unit: "USD" },
    { remaining: 0, unit: "USD" },
    { remaining: -3.456, unit: "CNY" },
    { remaining: null, unit: "USD" },
    { remaining: 1005, unit: "Credits" },
  ];
  const original = structuredClone(metrics);
  const html = renderToStaticMarkup(createElement(BillingBalanceMetrics, { metrics }));
  assert.match(html, /22\.54 USD/);
  assert.match(html, /127\.52 USD/);
  assert.match(html, /8\.00 USD/);
  assert.match(html, /0\.00 USD/);
  assert.match(html, /-3\.46 CNY/);
  assert.match(html, /未知 USD/);
  assert.match(html, /1005 Credits/);
  assert.doesNotMatch(html, /22\.544710299999906|127\.51546325/);
  assert.deepEqual(metrics, original);
});

test("balance widget shows Bailian monthly percentage and reset time", () => {
  const html = renderToStaticMarkup(createElement(BillingBalanceMetrics, { metrics: [{
    kind: "token_plan_monthly_remaining", remaining: 81.23567, unit: "%", resetAt: "2026-11-30T03:33:20.000Z",
  }] }));
  assert.match(html, /本月套餐剩余：81\.24%/);
  assert.match(html, /重置时间/);
});
