import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import type {
  AiNovelBillingMembershipRecord,
  AiNovelBillingTransactionRecord,
} from "../../src/shared/types.ts";

const membership: AiNovelBillingMembershipRecord = {
  appId: "ai_novel",
  userId: "user_a",
  active: true,
  state: "active",
  tier: "plus",
  planKey: "plus_monthly",
  expiresAt: "2026-10-01T00:00:00.000Z",
  autoRenew: true,
  source: "app_store",
  managementUrl: null,
  lastSyncedAt: "2026-09-20T00:00:00.000Z",
  accountDeletedAt: null,
};

const transaction: AiNovelBillingTransactionRecord = {
  appId: "ai_novel",
  userId: "user_a",
  provider: "revenuecat",
  providerTransactionId: "tx_a",
  productId: "plus_monthly",
  productKey: "plus_monthly",
  source: "app_store",
  platform: "ios",
  status: "entitlement_active",
  purchasedAt: "2026-09-01T00:00:00.000Z",
  originalPurchaseDate: "2026-09-01T00:00:00.000Z",
  expiresAt: membership.expiresAt,
  refundedAt: null,
  autoRenew: true,
  isSandbox: true,
  amountMinor: 999,
  refundAmountMinor: null,
  currency: "USD",
  observedAt: membership.lastSyncedAt,
  accountDeletedAt: null,
};

test("in-memory billing store deduplicates transaction and webhook IDs and ignores stale snapshots", async () => {
  const database = new InMemoryDatabase();
  database.upsertAiNovelBillingMembership(membership);
  database.upsertAiNovelBillingMembership({ ...membership, active: false, state: "free", tier: null, planKey: null, lastSyncedAt: "2026-09-19T00:00:00.000Z" });
  database.upsertAiNovelBillingTransaction(transaction);
  database.upsertAiNovelBillingTransaction({
    ...transaction,
    status: "refunded",
    amountMinor: 499,
    refundAmountMinor: 200,
    currency: "EUR",
    observedAt: "2026-09-19T00:00:00.000Z",
  });
  assert.equal((await database.findAiNovelBillingMembership("ai_novel", "user_a"))?.active, true);
  const [retainedTransaction] = await database.listAiNovelBillingTransactions("ai_novel", "user_a");
  assert.equal((await database.listAiNovelBillingTransactions("ai_novel", "user_a")).length, 1);
  assert.equal(retainedTransaction?.status, "entitlement_active");
  assert.equal(retainedTransaction?.amountMinor, 999);
  assert.equal(retainedTransaction?.refundAmountMinor, 200);
  assert.equal(retainedTransaction?.currency, "USD");
  const event = {
    appId: "ai_novel" as const,
    eventId: "evt_a",
    eventType: "INITIAL_PURCHASE",
    userId: "user_a",
    productId: "plus_monthly",
    providerTransactionId: null,
    status: "processed" as const,
    occurredAt: null,
    processedAt: "2026-09-20T00:00:00.000Z",
    accountDeletedAt: null,
  };
  assert.equal(database.insertAiNovelBillingWebhookEvent(event), true);
  assert.equal(database.insertAiNovelBillingWebhookEvent(event), false);
});

test("stale verified transaction facts backfill missing snapshot fields only", async () => {
  const database = new InMemoryDatabase();
  database.upsertAiNovelBillingTransaction({
    ...transaction,
    amountMinor: null,
    currency: null,
    observedAt: "2026-09-20T00:00:00.000Z",
  });
  database.upsertAiNovelBillingTransaction({
    ...transaction,
    amountMinor: 999,
    currency: "USD",
    status: "purchased",
    observedAt: "2026-09-19T00:00:00.000Z",
  });

  const [merged] = await database.listAiNovelBillingTransactions("ai_novel", "user_a");
  assert.equal(merged?.amountMinor, 999);
  assert.equal(merged?.currency, "USD");
  assert.equal(merged?.status, "entitlement_active");
  assert.equal(merged?.observedAt, "2026-09-20T00:00:00.000Z");
});

test("account deletion deactivates membership and marks retained transaction and webhook evidence", async () => {
  const database = new InMemoryDatabase();
  database.upsertAiNovelBillingMembership(membership);
  database.upsertAiNovelBillingTransaction(transaction);
  const event = {
    appId: "ai_novel" as const,
    eventId: "evt_delete",
    eventType: "INITIAL_PURCHASE",
    userId: "user_a",
    productId: "plus_monthly",
    providerTransactionId: "tx_a",
    status: "processed" as const,
    occurredAt: transaction.purchasedAt,
    processedAt: transaction.observedAt,
    accountDeletedAt: null,
  };
  database.insertAiNovelBillingWebhookEvent(event);
  const deletedAt = "2026-09-24T00:00:00.000Z";
  database.deleteAppUserRuntimeData("ai_novel", "user_a", deletedAt);
  assert.equal((await database.findAiNovelBillingMembership("ai_novel", "user_a"))?.active, false);
  const rows = await database.listAiNovelBillingTransactions("ai_novel", "user_a");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.accountDeletedAt, deletedAt);
  assert.equal(database.findAiNovelBillingWebhookEvent("ai_novel", "evt_delete")?.accountDeletedAt, deletedAt);
});
