import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { localLoginDefaults } from "../../apps/admin-web/local-login-defaults.ts";
import { createAdminServer } from "../../apps/admin-web/server.ts";

const credentials = { username: "admin", password: "LocalTestPassword!" };
const env = { ADMIN_BASIC_AUTH_USERNAME: credentials.username, ADMIN_BASIC_AUTH_PASSWORD: credentials.password };

test("runtime config sends test credentials only for the local server", async () => {
  const keys = ["APP_ENV", "NODE_ENV", ...Object.keys(env)];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const server = createAdminServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    Object.assign(process.env, env);
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    for (const APP_ENV of ["local", "dev", "online", "prod", "production", ""]) {
      process.env.APP_ENV = APP_ENV;
      delete process.env.NODE_ENV;
      const response = await fetch(`http://127.0.0.1:${address.port}/_admin/runtime-config.js`);
      const body = await response.text();
      assert.equal(response.headers.get("cache-control"), "no-store");
      const context: { window: { __ADMIN_RUNTIME_CONFIG__?: any } } = { window: {} };
      runInNewContext(body, context);
      assert.equal(context.window.__ADMIN_RUNTIME_CONFIG__.localLoginDefaults?.password,
        APP_ENV === "local" ? credentials.password : undefined);
      if (APP_ENV !== "local") assert.ok(!body.includes(credentials.password));
    }
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("login defaults are restricted to explicit local non-production configuration", () => {
  assert.deepEqual(localLoginDefaults({ ...env, APP_ENV: "local" }), credentials);
  for (const APP_ENV of [undefined, "dev", "online", "prod", "production", "test"]) {
    assert.equal(localLoginDefaults({ ...env, APP_ENV }), undefined);
  }
  assert.equal(localLoginDefaults({ ...env, APP_ENV: "local", NODE_ENV: "production" }), undefined);
  assert.equal(localLoginDefaults({ APP_ENV: "local", ADMIN_BASIC_AUTH_USERNAME: "admin" }), undefined);
});

for (const scenario of [{ local: true, fail: false }, { local: false, fail: false }, { local: true, fail: true }]) {
  const { local, fail } = scenario;
  test(`login form local=${local} fail=${fail} preserves defaults and actual errors`, async () => {
    const requireAdmin = createRequire(new URL("../../apps/admin-web/package.json", import.meta.url));
    const ts = requireAdmin("typescript");
    const source = await readFile(new URL("../../apps/admin-web/app/routes/login.tsx", import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const cells: unknown[] = [];
    let index = 0;
    let calls = 0;
    let submitted: string[] = [];
    const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
    const modules: Record<string, unknown> = {
      "react": { useState: (initial: unknown) => {
        const position = index++;
        if (!(position in cells)) cells[position] = initial;
        return [cells[position], (value: unknown) => { cells[position] = value; }];
      } },
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "react-router": { Navigate: "Navigate" },
      "../lib/format": { formatApiError: (error: Error) => error.message },
      "antd": { Alert: "Alert", Button: "Button", Card: "Card", Form: { Item: "FormItem" },
        Input: { Password: "Password" }, Typography: { Title: "Title" } },
      "../lib/admin-session": { useAdminSession: () => ({ adminUser: "", authenticating: false,
        runtimeConfig: { brandName: "Zook", localLoginDefaults: local ? credentials : undefined },
        login: async (...values: string[]) => {
          calls++; submitted = values;
          if (fail) throw new Error("CORS blocked: http://192.168.10.12:3112");
        },
      }) },
    };
    const exports: { default?: () => unknown } = {};
    runInNewContext(compiled, { exports, require: (name: string) => {
      assert.ok(name in modules, `Unexpected dependency ${name}`);
      return modules[name];
    } });
    function nodes(tree: any): any[] {
      if (Array.isArray(tree)) return tree.flatMap(nodes);
      if (!tree || typeof tree !== "object") return [];
      return [tree, ...nodes(tree.props.children)];
    }
    const render = () => { index = 0; return nodes(exports.default!()); };
    let tree = render();
    const username = tree.find(node => node.props.autoComplete === "username");
    const password = tree.find(node => node.props.autoComplete === "current-password");
    assert.equal(username.props.value, local ? credentials.username : "");
    assert.equal(password.props.value, local ? credentials.password : "");
    assert.equal(calls, 0);
    username.props.onChange({ target: { value: "manual" } });
    password.props.onChange({ target: { value: "edited" } });
    tree = render();
    tree.find(node => node.props.onFinish).props.onFinish();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.deepEqual(submitted, ["manual", "edited"]);
    if (fail) {
      const alert = render().find(node => node.type === "Alert");
      assert.equal(alert.props.message, "CORS blocked: http://192.168.10.12:3112");
    }
  });
}
