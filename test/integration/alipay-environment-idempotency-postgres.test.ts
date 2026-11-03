import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { PostgresAlipayOrders } from "../../src/infrastructure/database/postgres/postgres-alipay-orders.ts";
import { inBillingEnvironment } from "../../src/modules/billing/billing-environment.ts";
import type { AlipayOrder } from "../../src/modules/billing/alipay-models.ts";

const url = process.env.BILLING_TEST_DATABASE_URL;
test("real PostgreSQL migration preserves old retries and isolates the same key in both environments", { skip: !url }, async () => {
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  const schema = `alipay_scope_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema}`);
    const migrations = new URL("../../src/infrastructure/database/postgres/migrations/", import.meta.url);
    const original = await readFile(new URL("071_ai_novel_alipay_orders.sql", migrations), "utf8");
    await client.query(original.slice(original.indexOf("CREATE TABLE IF NOT EXISTS zook_ai_novel_alipay_orders")));
    const store = new PostgresAlipayOrders((sql, values) => client.query(sql, values));
    const order: AlipayOrder = { orderId: `alp_${"a".repeat(32)}`, appId: "ai_novel", userId: "user",
      provider: "alipay", merchantAppId: "live_merchant", sellerId: "", environment: "production", platform: "windows", distribution: "windows",
      productKey: "plus_monthly", idempotencyKey: "same_retry_identity", status: "pending", amountMinor: 3800, currency: "CNY",
      createdAt: "2026-11-03T10:00:00Z", expiresAt: "2026-11-03T10:30:00Z", paidAt: null, providerTransactionId: null,
      membershipApplied: false, membershipExpiresAt: null, conflict: null, accountDeletedAt: null };
    await store.save(order);
    await client.query(await readFile(new URL("084_ai_novel_alipay_environment_idempotency.sql", migrations), "utf8"));
    await client.query(await readFile(new URL("084_ai_novel_alipay_environment_idempotency.sql", migrations), "utf8"));
    const sandbox: AlipayOrder = { ...order, orderId: `alp_${"b".repeat(32)}`, environment: "sandbox", merchantAppId: "sandbox_merchant" };
    await store.save(sandbox);
    for (const expected of [order, sandbox]) {
      const result = await inBillingEnvironment(expected.environment, () => store.findIdempotency("user", "same_retry_identity"));
      assert.deepEqual(result, expected);
    }
    await client.query("SAVEPOINT duplicate_key");
    await assert.rejects(() => store.save({ ...sandbox, orderId: `alp_${"c".repeat(32)}` }), { code: "23505" });
    await client.query("ROLLBACK TO SAVEPOINT duplicate_key");
    assert.equal((await client.query("SELECT count(*) AS count FROM zook_ai_novel_alipay_orders")).rows[0].count, "2");
  } finally {
    await client.query("ROLLBACK"); client.release(); await pool.end();
  }
});
