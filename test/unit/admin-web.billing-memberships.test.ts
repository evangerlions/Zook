import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";

async function harness() {
  const ts = createRequire(new URL("../../apps/admin-web/package.json", import.meta.url))("typescript");
  const cells: any[] = [];
  let index = 0;
  let query: any;
  const jsx = (type: any, props: any) => ({ type, props });
  const modules: Record<string, any> = {
    react: { useState: (initial: any) => { const position = index++; if (!(position in cells)) cells[position] = initial; return [cells[position], (value: any) => { cells[position] = value; }]; } },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    antd: Object.fromEntries(["Alert", "Button", "Input", "Select", "Space", "Table", "Tooltip"].map((name) => [name, name])),
    "@ant-design/icons": Object.fromEntries(["CheckCircleFilled", "ClockCircleOutlined", "CloseCircleFilled", "MinusCircleOutlined", "QuestionCircleOutlined", "StopOutlined", "UserDeleteOutlined"].map((name) => [name, name])),
    "../lib/billing-admin-api": { billingAdminApi: { memberships: (value: any) => { query = value; } } },
    "../lib/format": { formatTimestamp: String },
    "../lib/use-billing-query": { useBillingQuery: (load: any) => { load(); return { data: { items: [], nextCursor: "next" }, refresh: () => {} }; } },
  };
  async function load(file: string) {
    const source = await readFile(new URL(`../../apps/admin-web/app/components/${file}.tsx`, import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const exports: any = {};
    runInNewContext(compiled, { exports, require: (name: string) => { assert.ok(name in modules, name); return modules[name]; } });
    return exports;
  }
  const status = await load("billing-membership-status");
  modules["./billing-membership-status"] = status;
  const section = await load("billing-memberships-section");
  const render = () => { index = 0; return section.BillingMembershipsSection({ appId: "ai_novel" }); };
  function find(node: any, type: string, predicate = (_: any) => true): any {
    if (Array.isArray(node)) return node.map((item) => find(item, type, predicate)).find(Boolean);
    if (!node || typeof node !== "object") return;
    return node.type === type && predicate(node.props) ? node : find(node.props.children, type, predicate);
  }
  return { render, find, status, query: () => query };
}

test("membership icons have distinct states and accessible Chinese explanations", async () => {
  const { status } = await harness();
  const icons = new Set();
  for (const state of ["active", "expired", "cancelled", "grace_period", "free", "unknown"]) {
    const member = { state, active: state === "active", accountDeletedAt: null };
    const presentation = status.membershipStatus(member);
    icons.add(presentation.Icon);
    const node = status.BillingMembershipStatus({ member });
    assert.equal(node.props.title, presentation.label);
    assert.equal(node.props.children.props["aria-label"], presentation.label);
  }
  assert.equal(icons.size, 6);
  assert.equal(status.membershipStatus({ active: true, state: "active", accountDeletedAt: "today" }).label, "账号已删除");
});

test("expiry filter is sent to server, resets pagination, and clears to all", async () => {
  const view = await harness();
  let tree = view.render();
  view.find(tree, "Button", (props) => props.children === "下一页").props.onClick();
  tree = view.render();
  assert.equal(view.query().cursor, "next");
  view.find(tree, "Select").props.onChange("expired");
  tree = view.render();
  assert.equal(view.query().expiry, "expired");
  assert.equal(view.query().cursor, undefined);
  view.find(tree, "Select").props.onChange("not_expired");
  tree = view.render();
  assert.equal(view.query().expiry, "not_expired");
  view.find(tree, "Button", (props) => props.children === "清空").props.onClick();
  view.render();
  assert.equal(view.query().expiry, undefined);
});
