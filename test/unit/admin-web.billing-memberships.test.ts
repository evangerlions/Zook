import * as billingTerms from "../../apps/admin-web/app/lib/billing-terms.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";

async function harness(environment = "PRODUCTION", onOpenPayments?: (member: any) => void) {
  const ts = createRequire(new URL("../../apps/admin-web/package.json", import.meta.url))("typescript");
  const cells: any[] = [];
  let index = 0;
  let query: any;
  const jsx = (type: any, props: any) => ({ type, props });
  const modules: Record<string, any> = {
    "../lib/billing-terms": billingTerms,
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
  const renewal = await load("billing-renewal-status");
  modules["./billing-renewal-status"] = renewal;
  const section = await load("billing-memberships-section");
  const render = () => { index = 0; return section.BillingMembershipsSection({ appId: "ai_novel", environment, onOpenPayments }); };
  function find(node: any, type: string, predicate = (_: any) => true): any {
    if (Array.isArray(node)) return node.map((item) => find(item, type, predicate)).find(Boolean);
    if (!node || typeof node !== "object") return;
    return node.type === type && predicate(node.props) ? node : find(node.props.children, type, predicate);
  }
  return { render, find, status, renewal, query: () => query };
}

test("renewal status displays the original value and accessible explanation", async () => {
  const view = await harness();
  const column = view.find(view.render(), "Table").props.columns.find((item: any) => item.title === "续订状态");
  const cell = column.render(null, { revenueCatRenewalStatus: "will_not_renew", autoRenew: false });
  assert.equal(cell.props.value, "will_not_renew");
  const tooltip = view.renewal.BillingRenewalStatus(cell.props);
  assert.match(tooltip.props.title, /已关闭续订/);
  assert.equal(tooltip.props.children.props.children, "will_not_renew");
  assert.equal(tooltip.props.children.props.tabIndex, 0);
  const unknown = view.renewal.BillingRenewalStatus({ value: "future_status" });
  assert.equal(unknown.props.children.props.children, "future_status");
  assert.match(unknown.props.title, /未识别/);
  assert.equal(view.renewal.BillingRenewalStatus({ value: null }).props.children, "—");
});

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


test("member list sends selected environment and explains its single-environment scope", async()=>{
  for(const environment of ["PRODUCTION","SANDBOX"]){
    const view=await harness(environment);const tree=view.render();
    assert.equal(view.query().environment,environment);
    const message=view.find(tree,"Alert").props.message;
    assert.ok(message.includes(environment==="SANDBOX"?"沙箱":"正式"));
    assert.ok(!message.includes("包含测试及正式会员"));
  }
});


test('membership source and tier cells use canonical display values',async()=>{
  const view=await harness('SANDBOX');const tree=view.render();
  const columns=view.find(tree,'Table').props.columns;
  const source=columns.find((column:any)=>column.dataIndex==='source');
  assert.equal(source.title,billingTerms.BILLING_TERMS.source.label);
  assert.equal(source.render('app_store'),'App Store');
  assert.equal(source.render('play_store'),'Google Play');
  const tier=columns.find((column:any)=>column.dataIndex==='tier');
  assert.equal(tier.title,'会员等级');assert.equal(tier.render('plus'),'Plus');
});


test("member user ID opens payments with the row identity, including all-app results", async () => {
  let selected: any;
  const view = await harness("SANDBOX", (member) => { selected = member; });
  const column = view.find(view.render(), "Table").props.columns.find((item: any) => item.dataIndex === "userId");
  const member = { appId: "another_app", userId: "user-exact", environment: "SANDBOX" };
  const link = column.render(member.userId, member);
  assert.equal(link.type, "Button");
  assert.equal(link.props.type, "link");
  assert.equal(link.props.children, member.userId);
  link.props.onClick();
  assert.equal(selected, member);
});
