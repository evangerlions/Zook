import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import { PostgresAiNovelBillingStore } from "../../src/infrastructure/database/postgres/postgres-ainovel-billing.ts";
import type {
  AiNovelBillingTransactionRecord,
  AiNovelBillingWebhookEventRecord,
} from "../../src/shared/types.ts";

function result(rowCount: number): QueryResult<QueryResultRow> {
  return {
    command: "INSERT",
    rowCount,
    oid: 0,
    fields: [],
    rows: [],
  };
}

const transaction: AiNovelBillingTransactionRecord = {
  appId: "ai_novel",
  userId: "user_alice",
  provider: "revenuecat",
  providerTransactionId: "txn-1",
  productId: "plus_monthly",
  productKey: "plus_monthly",
  source: "app_store",
  platform: "ios",
  status: "entitlement_active",
  purchasedAt: "2026-09-23T10:00:00.000Z",
  originalPurchaseDate: "2026-09-23T10:00:00.000Z",
  expiresAt: "2026-10-23T10:00:00.000Z",
  refundedAt: null,
  autoRenew: true,
  isSandbox: true,
  amountMinor: 999,
  refundAmountMinor: null,
  currency: "USD",
  observedAt: "2026-09-23T10:00:00.000Z",
  accountDeletedAt: null,
};

const event: AiNovelBillingWebhookEventRecord = {
  appId: "ai_novel",
  eventId: "event-1",
  eventType: "INITIAL_PURCHASE",
  userId: "user_alice",
  productId: "plus_monthly",
  providerTransactionId: "txn-1",
  status: "processed",
  occurredAt: "2026-09-23T10:00:00.000Z",
  processedAt: "2026-09-23T10:00:01.000Z",
  accountDeletedAt: null,
};

test("Postgres billing store upserts provider transaction evidence by stable identity", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const store = new PostgresAiNovelBillingStore(async (sql, values) => {
    queries.push({ sql, values });
    return result(1);
  });

  await store.upsertTransaction(transaction);

  assert.match(queries[0]?.sql ?? "", /ON CONFLICT \(app_id, user_id, provider_transaction_id\) DO UPDATE/);
  assert.match(queries[0]?.sql ?? "", /status = CASE WHEN zook_ai_novel_billing_transactions\.observed_at <= EXCLUDED\.observed_at/);
  assert.match(queries[0]?.sql ?? "", /amount_minor = CASE WHEN .* THEN COALESCE\(EXCLUDED\.amount_minor, .*\) ELSE COALESCE\(.*amount_minor, EXCLUDED\.amount_minor\) END/);
  assert.match(queries[0]?.sql ?? "", /refund_amount_minor = CASE WHEN .* THEN COALESCE\(EXCLUDED\.refund_amount_minor, .*\) ELSE COALESCE\(.*refund_amount_minor, EXCLUDED\.refund_amount_minor\) END/);
  assert.match(queries[0]?.sql ?? "", /currency = CASE WHEN .* THEN COALESCE\(EXCLUDED\.currency, .*\) ELSE COALESCE\(.*currency, EXCLUDED\.currency\) END/);
  assert.match(queries[0]?.sql ?? "", /observed_at = GREATEST\(zook_ai_novel_billing_transactions\.observed_at, EXCLUDED\.observed_at\)/);
  assert.deepEqual(queries[0]?.values?.slice(0, 6), [
    "ai_novel",
    "user_alice",
    "revenuecat",
    "txn-1",
    "plus_monthly",
    "plus_monthly",
  ]);
});

test("Postgres admin payment-status filters use the same evidence as the API", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const store = new PostgresAiNovelBillingStore(async (sql, values) => {
    queries.push({ sql, values });
    return { ...result(0), command: "SELECT" };
  });

  await store.listAdminOrders({
    appId: "ai_novel",
    status: "provider_paid",
    limit: 20,
  });
  assert.match(queries[0]?.sql ?? "", /status <> 'refunded' AND amount_minor > 0/);
  assert.doesNotMatch(queries[0]?.sql ?? "", /status = \$2/);

  await store.listAdminOrders({
    appId: "ai_novel",
    status: "unknown",
    limit: 20,
  });
  assert.match(
    queries[1]?.sql ?? "",
    /status <> 'refunded' AND \(amount_minor IS NULL OR amount_minor <= 0\)/,
  );
});

test("Postgres billing webhook event insertion is idempotent on app and provider event ID", async () => {
  let alreadyInserted = false;
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const store = new PostgresAiNovelBillingStore(async (sql, values) => {
    queries.push({ sql, values });
    if (alreadyInserted) return result(0);
    alreadyInserted = true;
    return result(1);
  });

  assert.equal(await store.insertWebhookEvent(event), true);
  assert.equal(await store.insertWebhookEvent(event), false);
  assert.match(queries[0]?.sql ?? "", /ON CONFLICT \(app_id, event_id\) DO NOTHING/);
  assert.equal(queries[0]?.values?.[5], "txn-1");
  assert.match(queries[0]?.sql ?? "", /account_deleted_at/);
});

test("Postgres billing account deletion marks retained webhook audit rows", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const store = new PostgresAiNovelBillingStore(async (sql, values) => {
    queries.push({ sql, values });
    return result(1);
  });
  const deletedAt = "2026-09-24T00:00:00.000Z";

  await store.softDeleteAccount("ai_novel", "user_alice", deletedAt);

  assert.equal(queries.length, 3);
  assert.match(queries[2]?.sql ?? "", /UPDATE zook_ai_novel_billing_webhook_events/);
  assert.match(queries[2]?.sql ?? "", /account_deleted_at = \$3::timestamptz/);
  assert.deepEqual(queries[2]?.values, ["ai_novel", "user_alice", deletedAt]);
});
