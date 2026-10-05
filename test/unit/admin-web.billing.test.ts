import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { adminApi } from "../../apps/admin-web/app/lib/admin-api.ts";
import { billingAdminApi } from "../../apps/admin-web/app/lib/billing-admin-api.ts";
import { billingStatusLabel, formatBillingMoney } from "../../apps/admin-web/app/lib/billing-format.ts";
import { billingOrdersViewHarness } from "../support/billing-orders-view-harness.ts";

const source = (path: string) => readFile(new URL(`../../apps/admin-web/app/${path}`, import.meta.url), "utf8");

test("billing orders offer Alipay provider and CN distribution filters", async () => {
  const queries: Array<Record<string, unknown>> = [];
  const view = await billingOrdersViewHarness({ getBillingOrders: async (query: Record<string, unknown>) => {
    queries.push(query);
    return { items: [], nextCursor: null };
  } });
  let tree = view.render();
  const provider = view.find(tree, "Select", (props) => props["aria-label"] === "支付渠道")!;
  assert.ok(provider);
  assert.ok(provider.props.options.some((option: { value: string }) => option.value === "alipay"));
  provider.props.onChange("alipay");
  view.find(tree, "Select", (props) => props["aria-label"] === "商店")!.props.onChange("web");
  tree = view.render();
  view.find(tree, "Button", (props) => props.children === "查询")!.props.onClick();
  await view.flush();
  assert.equal(queries[0].provider, "alipay");
  assert.equal(queries[0].distribution, "web");
  assert.equal(billingStatusLabel("pending"), "待付款");
  assert.equal(billingStatusLabel("closed"), "已关闭");
  assert.equal(billingStatusLabel("failed"), "失败");
});

test("revenue table shows UTC date first and identifies rows by date as well as app/channel/currency", async () => {
  const overview = await source("components/billing-overview-section.tsx");
  assert.match(overview, /columns=\{\[\s*\{ title: "日期（UTC）", dataIndex: "date"/);
  assert.match(overview, /rowKey=\{\(row\) => `\$\{row.date\}:/);
});

test("a failed replacement filter clears old rows and cursor, rather than mixing users on load-more", async () => {
  const requests: Array<Record<string, unknown>> = [];
  let fail = false;
  const view = await billingOrdersViewHarness({ getBillingOrders: async (query: Record<string, unknown>) => {
    requests.push(query);
    if (fail) throw new Error("Temporary failure");
    return { items: [{ userId: query.userId, paymentId: `${query.userId}:tx` }], nextCursor: "alice-cursor" };
  } });
  let tree = view.render();
  view.find(tree, "Input", (props) => props["aria-label"] === "用户 ID")!.props.onChange({ target: { value: "alice" } });
  tree = view.render();
  view.find(tree, "Button", (props) => props.children === "查询")!.props.onClick();
  await view.flush(); tree = view.render();
  assert.equal(view.find(tree, "Table")!.props.dataSource[0].userId, "alice");
  assert.ok(view.find(tree, "Button", (props) => props.children === "加载更多"));
  fail = true;
  view.find(tree, "Input", (props) => props["aria-label"] === "用户 ID")!.props.onChange({ target: { value: "bob" } });
  tree = view.render();
  view.find(tree, "Button", (props) => props.children === "查询")!.props.onClick();
  await view.flush(); tree = view.render();
  assert.equal(view.find(tree, "Table")!.props.dataSource.length, 0);
  assert.equal(view.find(tree, "Button", (props) => props.children === "加载更多"), undefined);
  assert.equal(requests[1].userId, "bob"); assert.equal(requests[1].cursor, undefined);
});

test("billing lives only in Server sidebar and has independent app selection with explicit not-integrated state", async () => {
  const shell = await source("components/app-shell.tsx");
  const server = shell.slice(shell.indexOf("const SERVER_WORKSPACES"), shell.indexOf("const APP_WORKSPACES"));
  assert.match(server, /to: "\/billing"/);
  assert.doesNotMatch(shell.slice(shell.indexOf("const APP_WORKSPACES")), /billing-orders|pathname === "\/billing"/);
  const route = await source("routes/billing.tsx");
  assert.match(route, /useState\("all"\)/); assert.match(route, /该应用尚未接入支付管理/);
  assert.doesNotMatch(route, /selectedAppId/); assert.match(route, /key=\{appId\}/);
  assert.match(await source("routes.ts"), /route\("billing", "routes\/billing.tsx"\)/);
});

test("a slow old order response cannot replace the newly selected user", async () => {
  const pending: Array<(page: unknown) => void> = [];
  const view = await billingOrdersViewHarness({ getBillingOrders: () => new Promise((resolve) => pending.push(resolve)) });
  const queryUser = (userId: string) => {
    let tree = view.render();
    view.find(tree, "Input", (props) => props["aria-label"] === "用户 ID")!.props.onChange({ target: { value: userId } });
    tree = view.render();
    view.find(tree, "Button", (props) => props.children === "查询")!.props.onClick();
  };
  queryUser("alice"); queryUser("bob");
  pending[1]({ items: [{ userId: "bob" }], nextCursor: null });
  await view.flush();
  pending[0]({ items: [{ userId: "alice" }], nextCursor: "alice-cursor" });
  await view.flush();
  const tree = view.render();
  assert.equal(view.find(tree, "Table")!.props.dataSource[0].userId, "bob");
  assert.equal(view.find(tree, "Button", (props) => props.children === "加载更多"), undefined);
});

test("billing UI guards stale reads and keeps revenue separate from membership environment", async () => {
  const hook = await source("lib/use-billing-query.ts");
  assert.match(hook, /if \(current\) setState/); assert.match(hook, /current = false/);
  const orders = await source("components/billing-orders-section.tsx");
  assert.match(orders, /request !== ordersRequest.current/); assert.match(orders, /request !== detailRequest.current/);
  assert.match(orders, /detail\.order\.providerOrderId/);
  assert.match(orders, /detail\.order\.checkoutId/);
  const overview = await source("components/billing-overview-section.tsx");
  assert.match(overview, /useState\("PRODUCTION"\)/); assert.match(overview, /不同|币种/);
  assert.match(await source("components/billing-memberships-section.tsx"), /此列表包含测试及正式会员/);
});

test("billing money uses currency minor units and never fabricates unknown prices", () => {
  assert.equal(formatBillingMoney(null, "USD"), "—");
  assert.equal(formatBillingMoney(999, null), "—");
  assert.match(formatBillingMoney(999, "USD"), /9\.99/);
  assert.match(formatBillingMoney(3800, "CNY"), /38\.00/);
  assert.match(formatBillingMoney(100, "JPY"), /100/);
});

test("billing API client uses shared routes and explicitly scopes order details", async () => {
  const original = globalThis.fetch;
  const urls: URL[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(new URL(String(input), "http://localhost"));
    return new Response(JSON.stringify({ code: "OK", data: { items: [] }, message: "ok", requestId: "req_test" }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    await billingAdminApi.apps();
    await billingAdminApi.overview({ appId: "all", environment: "PRODUCTION" });
    await billingAdminApi.memberships({ appId: "ai_novel", userId: "user:with spaces" });
    await adminApi.getBillingOrders({ appId: "all", limit: 50 });
    await adminApi.getBillingOrder("user:tx", { appId: "ai_novel", eventsLimit: 50 });
    assert.deepEqual(urls.map((url) => url.pathname), ["/api/v1/admin/billing/apps", "/api/v1/admin/billing/overview", "/api/v1/admin/billing/memberships", "/api/v1/admin/billing/orders", "/api/v1/admin/billing/orders/user%3Atx"]);
    assert.equal(urls[1].searchParams.get("environment"), "PRODUCTION");
    assert.equal(urls[2].searchParams.get("userId"), "user:with spaces");
    assert.equal(urls[4].searchParams.get("appId"), "ai_novel");
  } finally { globalThis.fetch = original; }
});
