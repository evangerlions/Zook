import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { loadBillingEnvironment, saveBillingEnvironment } from "../../apps/admin-web/app/lib/billing-preferences.ts";

test("billing environment persistence defaults safely and tolerates storage restrictions", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  let stored: string | null = null;
  try {
    Reflect.deleteProperty(globalThis, "window");
    assert.equal(loadBillingEnvironment(), "PRODUCTION");
    assert.doesNotThrow(() => saveBillingEnvironment("SANDBOX"));
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
      getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; },
    } } });
    assert.equal(loadBillingEnvironment(), "PRODUCTION");
    saveBillingEnvironment("SANDBOX");
    assert.equal(loadBillingEnvironment(), "SANDBOX");
    saveBillingEnvironment("PRODUCTION");
    assert.equal(loadBillingEnvironment(), "PRODUCTION");
    stored = "invalid";
    assert.equal(loadBillingEnvironment(), "PRODUCTION");
    Object.defineProperty(globalThis, "window", { configurable: true, get() { throw new Error("Storage denied"); } });
    assert.equal(loadBillingEnvironment(), "PRODUCTION");
    assert.doesNotThrow(() => saveBillingEnvironment("SANDBOX"));
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("billing page owns one top-level environment selector and restores it on remount", async () => {
  const requireAdmin = createRequire(new URL("../../apps/admin-web/package.json", import.meta.url));
  const ts = requireAdmin("typescript");
  const source = await readFile(new URL("../../apps/admin-web/app/routes/billing.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  let saved = "PRODUCTION";
  let cells: unknown[] = [];
  let index = 0;
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const modules: Record<string, unknown> = {
    "react": { useEffect: () => undefined, useState: (initial: any) => {
      const position = index++;
      if (!(position in cells)) cells[position] = typeof initial === "function" ? initial() : initial;
      return [cells[position], (value: unknown) => { cells[position] = value; }];
    } },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "antd": { Alert: "Alert", Select: "Select", Space: "Space", Tabs: "Tabs" },
    "../components/billing-orders-section": { BillingOrdersSection: "Orders" },
    "../components/billing-overview-section": { BillingOverviewSection: "Overview" },
    "../components/billing-memberships-section": { BillingMembershipsSection: "Members" },
    "../lib/billing-admin-api": { billingAdminApi: { apps: () => undefined } },
    "../lib/use-billing-query": { useBillingQuery: () => ({ data: [] }) },
    "../lib/admin-session": { useAdminSession: () => ({ completeWorkspaceTransition: () => undefined }) },
    "../lib/billing-preferences": {
      loadBillingEnvironment: () => saved, saveBillingEnvironment: (value: string) => { saved = value; },
    },
  };
  const exports: { default?: () => any } = {};
  runInNewContext(compiled, { exports, require: (name: string) => {
    assert.ok(name in modules, `Unexpected module ${name}`);
    return modules[name];
  } });
  const render = () => { index = 0; return exports.default!(); };
  let tree = render();
  const filters = tree.props.children[1];
  const application = filters.props.children.find((node: any) => node?.props?.["aria-label"] === "支付应用筛选");
  const environment = filters.props.children.find((node: any) => node?.props?.["aria-label"] === "统计环境");
  assert.ok(application && environment, "both selectors must share the top filter row");
  environment.props.onChange("SANDBOX");
  assert.equal(saved, "SANDBOX");
  application.props.onChange("ai_novel");
  tree = render();
  const tabs = tree.props.children[3].props.children[1];
  assert.equal(tabs.props.items[0].children.props.environment, "SANDBOX");
  assert.equal(tabs.props.items[0].children.props.appId, "ai_novel");
  cells = []; // A browser refresh remounts the page.
  tree = render();
  assert.equal(tree.props.children[1].props.children.find((node: any) => node?.props?.["aria-label"] === "统计环境").props.value, "SANDBOX");
  const overview = await readFile(new URL("../../apps/admin-web/app/components/billing-overview-section.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(overview, /aria-label="统计环境"|setEnvironment/);
  assert.match(overview, /const query = \{ appId, environment,/);
});
