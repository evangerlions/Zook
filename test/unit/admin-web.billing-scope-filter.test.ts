import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import * as terms from "../../apps/admin-web/app/lib/billing-terms.ts";

test("scope filter collapses with a summary and restores the selected filters", async () => {
  const ts = createRequire(new URL("../../apps/admin-web/package.json", import.meta.url))("typescript");
  const source = await readFile(new URL("../../apps/admin-web/app/components/billing-scope-filter.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  let expanded = true;
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const modules: Record<string, unknown> = {
    react: { useState: () => [expanded, (value: boolean) => { expanded = value; }] },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    antd: { Select: "Select", Space: "Space" },
    "../lib/billing-terms": terms,
  };
  const exports: any = {};
  runInNewContext(compiled, { exports, require: (name: string) => { assert.ok(name in modules, name); return modules[name]; } });
  const props = { appId: "ai_novel", apps: [{ appId: "ai_novel", appName: "AI Novel", integrated: true }], loading: false, environment: "SANDBOX", onAppChange: () => {}, onEnvironmentChange: () => {} };
  let tree = exports.BillingScopeFilter(props);
  let [toggle, selectors] = tree.props.children;
  assert.equal(toggle.props["aria-expanded"], true);
  assert.equal(selectors.props.children[0].props.value, "ai_novel");
  assert.equal(selectors.props.children[1].props.value, "SANDBOX");
  toggle.props.onClick();
  tree = exports.BillingScopeFilter(props);
  [toggle, selectors] = tree.props.children;
  assert.equal(toggle.props["aria-expanded"], false);
  assert.equal(selectors, false);
  assert.equal(toggle.props.children[2].props.children.join(""), "AI Novel (ai_novel) · 沙箱环境");
  toggle.props.onClick();
  tree = exports.BillingScopeFilter(props);
  assert.equal(tree.props.children[1].props.children[0].props.value, "ai_novel");
  assert.equal(tree.props.children[1].props.children[1].props.value, "SANDBOX");
});
