import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client } from "pg";
import { PostgresAlipayOrders } from "../../src/infrastructure/database/postgres/postgres-alipay-orders.ts";
import { PostgresAiNovelBillingStore } from "../../src/infrastructure/database/postgres/postgres-ainovel-billing.ts";
import { queryBillingRevenue } from "../../src/infrastructure/database/postgres/postgres-billing-admin.ts";
import { alipayTransaction } from "../../src/services/ainovel-alipay-projection.ts";
import type { AlipayOrder } from "../../src/modules/billing/alipay-models.ts";

const connectionString = process.env.ALIPAY_TEST_DATABASE_URL;

test("Alipay migrations and repositories preserve checkout identity, access and financial reporting", {
  skip: !connectionString && "Set ALIPAY_TEST_DATABASE_URL to an isolated local test database",
}, async () => {
  const url = new URL(connectionString!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.match(url.pathname, /^\/orangewrite_alipay_test_[a-zA-Z0-9_]+$/);
  const client = new Client({ connectionString });
  const schema = `alipay_${randomUUID().replaceAll("-", "")}`;
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    const migrations = ["067_ai_novel_billing_revenuecat", "068_ai_novel_billing_unknown_evidence",
      "069_ai_novel_billing_webhook_account_deleted_at", "070_ai_novel_billing_transfer_audit_users",
      "071_ai_novel_alipay_orders", "071_ai_novel_alipay_orders",
      "072_ai_novel_order_product_prefix", "072_ai_novel_order_product_prefix",
      "073_ai_novel_order_business_identity", "073_ai_novel_order_business_identity"];
    for (const name of migrations) {
      await client.query(await readFile(new URL(`../../src/infrastructure/database/postgres/migrations/${name}.sql`, import.meta.url), "utf8"));
    }
    const query = (sql: string, values?: unknown[]) => client.query(sql, values);
    const orders = new PostgresAlipayOrders(query);
    const financial = new PostgresAiNovelBillingStore(query);
    await client.query("INSERT INTO zook_ai_novel_alipay_orders (order_id, app_id, user_id, idempotency_key, status, expires_at, environment, record) VALUES ($1, 'ai_novel', 'prefix_test', 'prefix_test', 'pending', NOW(), 'sandbox', '{}'::jsonb)", [`ow_${"e".repeat(32)}`]);
    await client.query("INSERT INTO zook_ai_novel_alipay_orders (order_id, app_id, user_id, idempotency_key, status, expires_at, environment, record) VALUES ($1, 'ai_novel', 'business_test', 'business_test', 'pending', NOW(), 'sandbox', '{}'::jsonb)", ["ow_and_a03_user_a_7d43b290fe8216ac"]);
    const order: AlipayOrder = {
      orderId: `alp_${"a".repeat(32)}`, appId: "ai_novel", userId: "pg_alipay_user",
      idempotencyKey: "postgres_checkout_01", provider: "alipay", productKey: "plus_monthly",
      platform: "web", distribution: "web", merchantAppId: "mock_app", sellerId: "mock_seller",
      environment: "sandbox", status: "pending", amountMinor: 3800, currency: "CNY",
      createdAt: "2026-10-04T01:00:00.000Z", expiresAt: "2026-10-04T01:30:00.000Z",
      paidAt: null, providerTransactionId: null, membershipApplied: false,
      membershipExpiresAt: null, conflict: null, accountDeletedAt: null,
    };
    await orders.save(order);
    assert.deepEqual(await orders.findIdempotency(order.userId, order.idempotencyKey), order);
    assert.equal((await orders.findOrder(order.orderId))?.status, "pending");
    await assert.rejects(orders.save({ ...order, orderId: `alp_${"b".repeat(32)}` }),
      (error: unknown) => (error as { code?: string }).code === "23505");

    const filter = { from: "2026-10-04T00:00:00Z", to: "2026-10-05T00:00:00Z", sandbox: true };
    // Even malformed legacy timestamps cannot turn an unpaid quote into income.
    await financial.upsertTransaction({ ...alipayTransaction(order, order.createdAt), purchasedAt: order.createdAt });
    assert.deepEqual(await queryBillingRevenue(query, filter), []);
    order.status = "paid";
    order.paidAt = "2026-10-04T01:01:00.000Z";
    order.providerTransactionId = "202610040000000001";
    order.membershipApplied = true;
    order.membershipExpiresAt = "2026-11-04T01:01:00.000Z";
    await orders.save(order);
    await orders.save(order);
    await financial.upsertTransaction(alipayTransaction(order, order.paidAt));
    await financial.upsertTransaction(alipayTransaction(order, order.paidAt));
    assert.equal((await orders.listAccess(order.userId, order.paidAt)).length, 1);
    const transactions = await financial.listTransactions("ai_novel", order.userId);
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].createdAt, order.createdAt);
    assert.equal(transactions[0].providerOrderId, order.providerTransactionId);
    assert.deepEqual(await queryBillingRevenue(query, filter), [{ date: "2026-10-04", appId: "ai_novel",
      source: "alipay", currency: "CNY", purchaseCount: 1, grossMinor: 3800, refundMinor: 0 }]);
    await assert.rejects(orders.save({ ...order, userId: "other_user", idempotencyKey: "other_checkout",
      orderId: `alp_${"c".repeat(32)}` }), (error: unknown) => (error as { code?: string }).code === "23505");
    order.accountDeletedAt = "2026-10-04T02:00:00.000Z";
    await orders.save(order);
    await financial.upsertTransaction(alipayTransaction(order, order.accountDeletedAt));
    assert.equal((await orders.listAccess(order.userId, order.paidAt)).length, 0);
    assert.equal((await orders.findOrder(order.orderId))?.status, "paid");
    assert.equal((await queryBillingRevenue(query, filter))[0].grossMinor, 3800);
  } finally {
    // Only the generated schema inside the explicitly isolated test database.
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
