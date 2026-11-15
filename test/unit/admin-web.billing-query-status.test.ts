import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
const req = createRequire(new URL("../../apps/admin-web/package.json", import.meta.url));
const { buildSync } = req("esbuild"), { createElement } = req("react"), { renderToStaticMarkup } = req("react-dom/server");
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL("../../apps/admin-web/app/components/billing-query-status.tsx", import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", write: false });
const mod = { exports: {} as any }; new Function("require", "module", "exports", bundle.outputFiles[0].text)(req, mod, mod.exports);
test("expired cached balance cannot render healthy; manual sources require login", () => {
 const render = (account: unknown) => renderToStaticMarkup(createElement(mod.exports.BillingQueryStatus, { account }));
 const stale = render({ mode: "automatic", sample: { status: "ok", stale: true } }); assert.match(stale, /已过期/); assert.doesNotMatch(stale, /正常/);
 assert.match(render({ mode: "manual" }), /需登录查询/); assert.match(render({ mode: "automatic", credentialConfigured: false }), /缺少凭证/);
});
