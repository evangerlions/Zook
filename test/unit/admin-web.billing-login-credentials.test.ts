import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
const req = createRequire(new URL("../../apps/admin-web/package.json", import.meta.url));
const { buildSync } = req("esbuild"), { createElement } = req("react"), { renderToStaticMarkup } = req("react-dom/server");
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL("../../apps/admin-web/app/components/billing-login-credentials.tsx", import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", write: false });
const mod = { exports: {} as any }; new Function("require", "module", "exports", bundle.outputFiles[0].text)(req, mod, mod.exports);
test("login renders distinct labelled username and masked password fields with a submit button", () => {
 const html = renderToStaticMarkup(createElement(mod.exports.BillingLoginCredentials, { busy: false, ready: true, onLogin: () => {} }));
 assert.match(html, /label[^>]*for="username"[^>]*>账户名称/);
 assert.match(html, /label[^>]*for="password"[^>]*>密码/);
 assert.match(html, /type="password"/); assert.match(html, /type="submit"/);
 assert.doesNotMatch(html, /输入到选中字段/);
});
