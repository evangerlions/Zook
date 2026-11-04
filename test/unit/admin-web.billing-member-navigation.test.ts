import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import * as terms from "../../apps/admin-web/app/lib/billing-terms.ts";
import { billingOrdersViewHarness } from "../support/billing-orders-view-harness.ts";

async function routeHarness() {
  const ts = createRequire(new URL("../../apps/admin-web/package.json", import.meta.url))("typescript");
  const source = await readFile(new URL("../../apps/admin-web/app/routes/billing.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const cells: any[] = [];
  let index = 0;
  const jsx = (type: any, props: any, key: any) => ({ type, props, key });
  const modules: Record<string, any> = {
    "react": { useEffect: () => {}, useState: (initial: any) => {
      const i = index++;
      if (!(i in cells)) cells[i] = typeof initial === "function" ? initial() : initial;
      return [cells[i], (value: any) => { cells[i] = value; }];
    } },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "antd": { Alert: "Alert", Select: "Select", Space: "Space", Tabs: "Tabs" },
    "../lib/billing-terms": terms,
    "../components/billing-scope-filter": { BillingScopeFilter: "ScopeFilter" },
    "../lib/billing-preferences": { loadBillingEnvironment: () => "SANDBOX", saveBillingEnvironment: () => {} },
    "../lib/admin-session": { useAdminSession: () => ({ completeWorkspaceTransition: () => {} }) },
    "../lib/billing-admin-api": { billingAdminApi: {} },
    "../lib/use-billing-query": { useBillingQuery: () => ({ data: [{ appId: "ai_novel", integrated: true }, { appId: "another_app", integrated: true }] }) },
  };
  for (const [file, name] of [["orders", "BillingOrdersSection"], ["memberships", "BillingMembershipsSection"], ["overview", "BillingOverviewSection"]]) {
    modules[`../components/billing-${file}-section`] = { [name]: name };
  }
  const exports: any = {};
  runInNewContext(compiled, { exports, require: (name: string) => { assert.ok(name in modules, name); return modules[name]; } });
  function find(node: any, type: string): any {
    if (Array.isArray(node)) return node.map((item) => find(item, type)).find(Boolean);
    if (!node || typeof node !== "object") return;
    return node.type === type ? node : find(node.props.children, type);
  }
  return { render: () => { index = 0; return exports.default(); }, find };
}

test("member drilldown selects actual app, user and orders tab while preserving sandbox", async () => {
  const view = await routeHarness();
  let tree = view.render();
  view.find(tree, "ScopeFilter").props.onAppChange("all");
  tree = view.render();
  let tabs = view.find(tree, "Tabs");
  tabs.props.items.find((item: any) => item.key === "members").children.props.onOpenPayments({ appId: "another_app", userId: "user-123" });
  tree = view.render();
  tabs = view.find(tree, "Tabs");
  const orders = tabs.props.items.find((item: any) => item.key === "orders").children;
  assert.equal(tabs.props.activeKey, "orders");
  assert.equal(view.find(tree, "ScopeFilter").props.appId, "another_app");
  assert.equal(orders.props.appId, "another_app");
  assert.equal(orders.props.environment, "SANDBOX");
  assert.equal(orders.props.initialUserId, "user-123");
  assert.ok(orders.key.includes("user-123"));
  tabs.props.onChange("members");
  tree = view.render();
  assert.equal(view.find(tree, "Tabs").props.items.find((item: any) => item.key === "orders").children.props.initialUserId, undefined);
});

test("drilldown immediately queries the exact user and environment, and clear resets to defaults", async () => {
  const calls: any[] = [];
  const view = await billingOrdersViewHarness({ getBillingOrders: async (query: any) => { calls.push(query); return { items: [] }; } }, "SANDBOX", "user-123");
  let tree = view.render();
  view.mount();
  await view.flush();
  assert.equal(view.find(tree, "Input", (p) => p["aria-label"] === "用户 ID")!.props.value, "user-123");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].userId, "user-123");
  assert.equal(calls[0].appId, "ai_novel");
  assert.equal(calls[0].environment, "SANDBOX");
  assert.equal(calls[0].status, "provider_paid");
  assert.equal(calls[0].cursor, undefined);
  assert.equal(calls[0].provider, undefined);
  tree = view.render();
  view.find(tree, "Button", (p) => p.children === "清空")!.props.onClick();
  await view.flush();
  assert.equal(calls.at(-1).userId, undefined);
  assert.equal(calls.at(-1).status, "provider_paid");
});
