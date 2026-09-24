import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";
import type {
  AiNovelBillingTransactionRecord,
  AiNovelBillingWebhookEventRecord,
} from "../../src/shared/types.ts";

const transaction = (
  providerTransactionId: string,
  observedAt: string,
): AiNovelBillingTransactionRecord => ({
  appId: "ai_novel",
  userId: "user_alice",
  provider: "revenuecat",
  providerTransactionId,
  productId: "plus_monthly",
  productKey: "plus_monthly",
  source: "app_store",
  platform: "ios",
  status: "entitlement_active",
  purchasedAt: observedAt,
  originalPurchaseDate: observedAt,
  expiresAt: "2026-10-23T10:00:00.000Z",
  refundedAt: null,
  autoRenew: true,
  isSandbox: true,
  amountMinor: 999,
  refundAmountMinor: null,
  currency: "USD",
  observedAt,
  accountDeletedAt: null,
});

const event: AiNovelBillingWebhookEventRecord = {
  appId: "ai_novel",
  eventId: "evt_001",
  eventType: "INITIAL_PURCHASE",
  userId: "user_alice",
  productId: "plus_monthly",
  providerTransactionId: "tx_001",
  status: "processed",
  occurredAt: "2026-09-23T10:00:01.000Z",
  processedAt: "2026-09-23T10:00:02.000Z",
  accountDeletedAt: null,
};

const adminOptions = {
  adminBasicAuth: { username: "admin", password: "AdminPass123!" },
};

async function loginAdmin(runtime: Awaited<ReturnType<typeof createApplication>>) {
  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/auth/login",
    headers: {},
    body: { username: "admin", password: "AdminPass123!" },
  });
  assert.equal(response.statusCode, 200);
  const cookie = response.headers?.["Set-Cookie"];
  assert.ok(cookie);
  return cookie;
}

test("AINovel billing admin list is session protected, filterable and cursor-paginated", async () => {
  const runtime = await createApplication(adminOptions);
  await runtime.database.upsertAiNovelBillingTransaction(
    transaction("tx_002", "2026-09-22T10:00:00.000Z"),
  );
  await runtime.database.upsertAiNovelBillingTransaction(
    transaction("tx_001", "2026-09-23T10:00:00.000Z"),
  );

  const unauthorized = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/ai_novel/billing/orders",
    headers: {},
  });
  assert.equal(unauthorized.statusCode, 401);

  const cookie = await loginAdmin(runtime);
  const first = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/ai_novel/billing/orders",
    headers: { cookie },
    query: { limit: "1", status: "entitlement_active", platform: "ios" },
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.data.items.length, 1);
  assert.equal(first.body.data.items[0].paymentId, "user_alice:tx_001");
  assert.equal(first.body.data.items[0].amountMinor, 999);
  assert.equal(first.body.data.items[0].paymentStatus, "provider_paid");
  assert.ok(first.body.data.nextCursor);

  const second = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/ai_novel/billing/orders",
    headers: { cookie },
    query: {
      limit: "1",
      status: "entitlement_active",
      platform: "ios",
      cursor: first.body.data.nextCursor,
    },
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.data.items[0].paymentId, "user_alice:tx_002");
  assert.equal(second.body.data.nextCursor, null);
  assert.equal(
    runtime.database.auditLogs.filter((row) => row.action === "admin.ai_novel_billing.orders.list").length,
    2,
  );
});

test("AINovel billing admin reports entitlement-only snapshots as unknown payment", async () => {
  const runtime = await createApplication(adminOptions);
  await runtime.database.upsertAiNovelBillingTransaction({
    ...transaction("tx_trial", "2026-09-23T10:00:00.000Z"),
    amountMinor: null,
    status: "entitlement_active",
  });
  const cookie = await loginAdmin(runtime);

  const response = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/ai_novel/billing/orders",
    headers: { cookie },
    query: { status: "entitlement_active" },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.items[0].paymentStatus, "unknown");

  const unknownFilter = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/ai_novel/billing/orders",
    headers: { cookie },
    query: { status: "unknown" },
  });
  assert.equal(unknownFilter.statusCode, 200);
  assert.equal(unknownFilter.body.data.items[0].paymentStatus, "unknown");
});

test("AINovel billing admin provider_paid filter uses displayed payment evidence", async () => {
  const runtime = await createApplication(adminOptions);
  await runtime.database.upsertAiNovelBillingTransaction(
    transaction("tx_paid", "2026-09-23T10:00:00.000Z"),
  );
  await runtime.database.upsertAiNovelBillingTransaction({
    ...transaction("tx_trial", "2026-09-23T10:01:00.000Z"),
    amountMinor: null,
  });
  const cookie = await loginAdmin(runtime);

  const response = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/ai_novel/billing/orders",
    headers: { cookie },
    query: { status: "provider_paid" },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(
    response.body.data.items.map((item: { paymentId: string }) => item.paymentId),
    ["user_alice:tx_paid"],
  );
  assert.equal(response.body.data.items[0].paymentStatus, "provider_paid");
});

test("AINovel billing admin detail returns provider evidence and event timeline", async () => {
  const runtime = await createApplication(adminOptions);
  await runtime.database.upsertAiNovelBillingTransaction(
    { ...transaction("tx_001", "2026-09-23T10:00:00.000Z"), accountDeletedAt: "2026-09-24T00:00:00.000Z" },
  );
  await runtime.database.upsertAiNovelBillingMembership({
    appId: "ai_novel",
    userId: "user_alice",
    active: true,
    state: "active",
    tier: "plus",
    planKey: "plus_monthly",
    expiresAt: "2020-01-01T00:00:00.000Z",
    autoRenew: false,
    source: "app_store",
    managementUrl: null,
    lastSyncedAt: "2020-01-01T00:00:00.000Z",
    accountDeletedAt: null,
  });
  await runtime.database.insertAiNovelBillingWebhookEvent({
    ...event,
    occurredAt: null,
    accountDeletedAt: "2026-09-24T00:00:00.000Z",
  });
  const cookie = await loginAdmin(runtime);

  const response = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/ai_novel/billing/orders/user_alice%3Atx_001",
    headers: { cookie },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.order.paymentId, "user_alice:tx_001");
  assert.equal(response.body.data.order.providerEntitlementId, "orangewrite_plus");
  assert.equal(response.body.data.order.deletedAt, "2026-09-24T00:00:00.000Z");
  assert.equal(response.body.data.transactions[0].providerTransactionId, "tx_001");
  assert.equal(response.body.data.currentMembership.active, false);
  assert.equal(response.body.data.currentMembership.state, "expired");
  assert.equal(response.body.data.events[0].providerEventId, "evt_001");
  assert.equal(response.body.data.events[0].occurredAt, null);
  assert.equal(response.body.data.events[0].accountDeletedAt, "2026-09-24T00:00:00.000Z");
  assert.ok(Array.isArray(response.body.data.entitlementGrants));
  assert.equal(
    runtime.database.auditLogs.filter((row) => row.action === "admin.ai_novel_billing.orders.detail").length,
    1,
  );
});

test("AINovel billing admin rejects malformed cursors and unknown order IDs", async () => {
  const runtime = await createApplication(adminOptions);
  const cookie = await loginAdmin(runtime);

  const invalidCursor = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/ai_novel/billing/orders",
    headers: { cookie },
    query: { cursor: "not-a-cursor" },
  });
  assert.equal(invalidCursor.statusCode, 400);

  const notFound = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/ai_novel/billing/orders/missing",
    headers: { cookie },
  });
  assert.equal(notFound.statusCode, 404);
});
