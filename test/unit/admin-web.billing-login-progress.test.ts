import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const req = createRequire(new URL("../../apps/admin-web/package.json", import.meta.url));
const { buildSync } = req("esbuild"), { createElement } = req("react"), { renderToStaticMarkup } = req("react-dom/server");
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL("../../apps/admin-web/app/components/billing-login-progress.tsx", import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", write: false });
const mod = { exports: {} as any }; new Function("require", "module", "exports", bundle.outputFiles[0].text)(req, mod, mod.exports);
const BillingLoginProgress = mod.exports.BillingLoginProgress;
test("login page visibly distinguishes opening, login and balance-query progress", () => {
  const render = (phase: string, busy = true, ready = false) => renderToStaticMarkup(createElement(BillingLoginProgress, { phase, busy, ready }));
  assert.match(render("opening"), /正在打开官方窗口并恢复登录状态/);
  assert.match(render("signing-in"), /正在提交登录/);
  assert.match(render("reading"), /正在使用当前登录会话查询余额/);
  assert.match(render("updating", false, true), /官方页面已就绪/);
  assert.match(render("opening", false, false), /连接未完成/);
});
