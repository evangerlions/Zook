import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";
import type { AiNovelBillingTransactionRecord } from "../../src/shared/types.ts";
import { queryBillingRevenue } from "../../src/infrastructure/database/postgres/postgres-billing-admin.ts";
import { aggregateBillingRevenue } from "../../src/testing/in-memory-billing-admin.ts";

async function setup() {
  const runtime = await createApplication({ adminBasicAuth: { username: "admin", password: "AdminPass123!" } });
  const login = await runtime.app.handle({ method: "POST", path: "/api/v1/admin/auth/login", headers: {}, body: { username: "admin", password: "AdminPass123!" } });
  const cookie = login.headers!["Set-Cookie"]!;
  const get = (resource: string, query: Record<string, string> = {}) => runtime.app.handle({ method: "GET", path: `/api/v1/admin/billing/${resource}`, headers: { cookie }, query });
  return { ...runtime, get };
}

function transaction(id: string, changes: Partial<AiNovelBillingTransactionRecord> = {}): AiNovelBillingTransactionRecord {
  return { appId: "ai_novel", userId: "user_alice", provider: "revenuecat", providerTransactionId: id,
    productId: "plus_monthly", productKey: "plus_monthly", source: "app_store", platform: "ios",
    status: "provider_paid", purchasedAt: "2026-09-10T00:00:00.000Z", originalPurchaseDate: null,
    expiresAt: null, refundedAt: null, autoRenew: true, isSandbox: false, amountMinor: 999,
    refundAmountMinor: null, currency: "USD", observedAt: "2026-09-10T00:00:00.000Z", accountDeletedAt: null, ...changes };
}

const window = { from: "2026-09-01T00:00:00Z", to: "2026-10-01T00:00:00Z" };

test("unsettled Alipay quotes never become revenue even if timestamps are present", async () => {
  const records = ["pending", "closed", "failed"].map((status) => transaction(status, {
    provider: "alipay", source: "alipay", platform: "web",
    status: status as AiNovelBillingTransactionRecord["status"], amountMinor: 3800, currency: "CNY",
    refundedAt: "2026-09-12T00:00:00Z", refundAmountMinor: 3800,
  }));
  assert.deepEqual(aggregateBillingRevenue(records, { ...window, sandbox: false }), []);
  const paid = transaction("paid", { provider: "alipay", source: "alipay", amountMinor: 3800, currency: "CNY" });
  const rows = aggregateBillingRevenue([...records, paid], { ...window, sandbox: false });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].grossMinor, 3800);
  assert.equal(rows[0].purchaseCount, 1);
  let sql = "";
  await queryBillingRevenue(async (text) => {
    sql = text;
    return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
  }, { ...window, sandbox: false });
  assert.equal((sql.match(/status NOT IN \('pending', 'closed', 'failed'\)/g) ?? []).length, 2);
});

test("daily revenue combines same-day purchases but separates UTC days and later refunds", () => {
  const rows = aggregateBillingRevenue([
    transaction("a", { purchasedAt: "2026-09-10T23:30:00Z", refundedAt: "2026-09-12T01:00:00Z", refundAmountMinor: 999 }),
    transaction("b", { purchasedAt: "2026-09-11T07:30:00+08:00" }),
    transaction("c", { purchasedAt: "2026-09-11T00:00:00Z" }),
    transaction("lower", { purchasedAt: "2026-09-01T00:00:00Z" }),
    transaction("upper", { purchasedAt: "2026-10-01T00:00:00Z" }),
  ], { ...window, sandbox: false });
  assert.deepEqual(rows.map(({ date, purchaseCount, grossMinor, refundMinor }) => ({ date, purchaseCount, grossMinor, refundMinor })), [
    { date: "2026-09-12", purchaseCount: 0, grossMinor: 0, refundMinor: 999 },
    { date: "2026-09-11", purchaseCount: 1, grossMinor: 999, refundMinor: 0 },
    { date: "2026-09-10", purchaseCount: 2, grossMinor: 1998, refundMinor: 0 },
    { date: "2026-09-01", purchaseCount: 1, grossMinor: 999, refundMinor: 0 },
  ]);
});

test("server billing routes require sessions and distinguish unknown/unintegrated app scopes", async () => {
  const runtime = await setup();
  for (const resource of ["apps", "overview", "memberships", "orders"]) {
    const response = await runtime.app.handle({ method: "GET", path: `/api/v1/admin/billing/${resource}`, headers: {} });
    assert.equal(response.statusCode, 401);
  }
  const apps = await runtime.get("apps");
  assert.equal(apps.body.data.find((app: { appId: string }) => app.appId === "ai_novel").integrated, true);
  const other = apps.body.data.find((app: { integrated: boolean }) => !app.integrated);
  assert.ok(other);
  for (const resource of ["overview", "memberships", "orders"]) {
    assert.equal((await runtime.get(resource, { appId: other.appId })).statusCode, 409);
    assert.equal((await runtime.get(resource, { appId: "not-an-app" })).statusCode, 400);
  }
  assert.equal((await runtime.get("orders/user_alice%3Ax")).statusCode, 400);
  const mutation = await runtime.app.handle({ method: "POST", path: "/api/v1/admin/billing/orders", headers: {} });
  assert.notEqual(mutation.statusCode, 200);
});

test("revenue defaults production, preserves deleted financial records, separates currencies/channels and refund dates", async () => {
  const runtime = await setup();
  for (const row of [
    transaction("usd", { status: "refunded", refundedAt: "2026-10-02T00:00:00Z", refundAmountMinor: 999, accountDeletedAt: "2026-09-20T00:00:00Z" }),
    transaction("old-refund", { purchasedAt: "2026-08-01T00:00:00Z", status: "refunded", refundedAt: "2026-09-20T00:00:00Z", refundAmountMinor: 500 }),
    transaction("cny", { amountMinor: 3800, currency: "CNY", source: "play_store" }),
    transaction("sandbox", { isSandbox: true }), transaction("unknown-env", { isSandbox: null }),
    transaction("unknown-price", { amountMinor: null }), transaction("no-currency", { currency: null }),
    transaction("no-date", { purchasedAt: null }), transaction("upper-bound", { purchasedAt: "2026-10-01T00:00:00.000Z" }),
  ]) await runtime.database.upsertAiNovelBillingTransaction(row);
  // Retried observations must not duplicate amounts.
  await runtime.database.upsertAiNovelBillingTransaction(transaction("cny", { amountMinor: 3800, currency: "CNY", source: "play_store" }));
  const response = await runtime.get("overview", window);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.environment, "PRODUCTION");
  const usd = response.body.data.rows.find((row: { currency: string }) => row.currency === "USD");
  assert.equal(usd.date, "2026-09-20"); assert.equal(usd.grossMinor, 0); assert.equal(usd.refundMinor, 500); assert.equal(usd.purchaseCount, 0);
  const purchase = response.body.data.rows.find((row: { currency: string; date: string }) => row.currency === "USD" && row.date === "2026-09-10");
  assert.equal(purchase.grossMinor, 999); assert.equal(purchase.refundMinor, 0); assert.equal(purchase.purchaseCount, 1);
  const cny = response.body.data.rows.find((row: { currency: string }) => row.currency === "CNY");
  assert.equal(cny.grossMinor, 3800); assert.equal(cny.source, "play_store");
  const sandbox = await runtime.get("overview", { ...window, environment: "SANDBOX" });
  assert.equal(sandbox.body.data.rows[0].grossMinor, 999);
  assert.equal((await runtime.get("overview", { ...window, environment: "all" })).statusCode, 400);
  assert.equal((await runtime.get("overview", { ...window, environment: "" })).statusCode, 400);
  assert.equal((await runtime.get("overview", { from: "invalid", to: window.to })).statusCode, 400);
  assert.equal((await runtime.get("overview", { from: "2020-01-01", to: window.to })).statusCode, 400);
  assert.ok(runtime.database.auditLogs.some((row) => row.action === "admin.billing.overview.list"));
});

test("membership browsing includes members without orders, applies expiry/deletion and bounds pagination", async () => {
  const runtime = await setup();
  for (const [userId, expiresAt, accountDeletedAt] of [
    ["member_a", "2099-01-01T00:00:00Z", null],
    ["member_b", "2020-01-01T00:00:00Z", null],
    ["member_c", "2099-01-01T00:00:00Z", "2026-09-01T00:00:00Z"],
  ] as const) await runtime.database.upsertAiNovelBillingMembership({ appId: "ai_novel", userId,
    active: true, state: "active", tier: "plus", planKey: "plus_monthly", expiresAt,
    autoRenew: true, source: "app_store", managementUrl: null, lastSyncedAt: "2026-09-01T00:00:00Z", accountDeletedAt });
  const first = await runtime.get("memberships", { limit: "1" });
  assert.equal(first.body.data.items[0].userId, "member_a"); assert.equal(first.body.data.items[0].active, true);
  const next = await runtime.get("memberships", { limit: "1", cursor: first.body.data.nextCursor });
  assert.equal(next.body.data.items[0].userId, "member_b"); assert.equal(next.body.data.items[0].state, "expired");
  const deleted = await runtime.get("memberships", { userId: "member_c" });
  assert.equal(deleted.body.data.items[0].active, false);
  await runtime.database.upsertAiNovelBillingTransaction(transaction("deleted-member", { userId: "member_c" }));
  const detail = await runtime.get("orders/member_c%3Adeleted-member", { appId: "ai_novel" });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.body.data.currentMembership.active, false);
  assert.equal((await runtime.get("memberships", { limit: "101" })).statusCode, 400);
});

test("Postgres revenue aggregates in SQL with parameters, excludes unknown environment and guards overflow", async () => {
  let sql = "", params: unknown[] = [];
  const rows = await queryBillingRevenue(async (text, values) => {
    sql = text; params = values;
    return { rows: [{ date: "2026-09-10", app_id: "ai_novel", source: "app_store", currency: "USD", purchase_count: "2", gross_minor: "1998", refund_minor: "0" }], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
  }, { ...window, sandbox: false });
  assert.match(sql, /GROUP BY date, app_id, source, currency/); assert.match(sql, /is_sandbox = \$3/);
  assert.match(sql, /AT TIME ZONE 'UTC'/); assert.match(sql, /UNION ALL/); assert.equal(rows[0].date, "2026-09-10");
  assert.match(sql, /refunded_at >= \$1/); assert.deepEqual(params, [window.from, window.to, false]); assert.equal(rows[0].grossMinor, 1998);
  await assert.rejects(queryBillingRevenue(async () => ({ rows: [{ purchase_count: "1", gross_minor: "9007199254740992", refund_minor: "0" }], rowCount: 1, command: "SELECT", oid: 0, fields: [] }), { ...window, sandbox: false }), /safe integer/);
});
