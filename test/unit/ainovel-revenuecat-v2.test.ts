import assert from "node:assert/strict";
import test from "node:test";
import { RevenueCatCustomerApi } from "../../src/services/ainovel-revenuecat-client.ts";
import { RevenueCatV2ReadSession } from "../../src/services/ainovel-revenuecat-read-session.ts";
import { normalizeRevenueCatSnapshot } from "../../src/modules/billing/ainovel-revenuecat-normalizer.ts";
import { fixtureFetcher, snapshot } from "../support/revenuecat-v2-fixtures.ts";
import { InMemoryAiNovelBillingStore } from "../../src/testing/in-memory-ai-novel-billing-store.ts";

test("V2 verifies product app ownership and uses transaction-local amounts, not subscription totals", async () => {
  const requests: string[] = [];
  const fixture = fixtureFetcher(async () => Response.json(snapshot()), "app_test");
  const api = new RevenueCatCustomerApi({
    secretApiKey: "unit-test-key", projectId: "proj_test", appId: "app_test",
    now: () => new Date("2026-09-24T00:00:00Z"),
    fetcher: async (input, init) => {
      const url = String(input); requests.push(url);
      const response = await fixture(input, init);
      const body = await response.json();
      if (url.includes("/transactions")) {
        body.items[0].revenue_in_local_currency = { currency: "CNY", gross: 38 };
      } else if (url.includes("/customers/user/")) {
        for (const item of body.items) item.total_revenue_in_usd = { currency: "USD", gross: 999 };
      }
      return Response.json(body);
    },
  });
  const evidence = await api.getSnapshot("user");
  const result = normalizeRevenueCatSnapshot(evidence, "user", new Date("2026-09-24"), { allowSandbox: true });
  assert.equal(result.membership.tier, "plus");
  assert.equal(result.transactions[0].amountMinor, 3800);
  assert.equal(result.transactions[0].currency, "CNY");
  assert.ok(requests.every(url => url.startsWith("https://api.revenuecat.com/v2/projects/proj_test/")));
  assert.ok(requests.some(url => url.includes("/products/")));
});

test("V2 excludes subscriptions belonging to another app", async () => {
  const api = new RevenueCatCustomerApi({ secretApiKey: "unit-test-key", projectId: "proj_test", appId: "expected",
    fetcher: fixtureFetcher(async () => Response.json(snapshot()), "other") });
  assert.deepEqual((await api.getSnapshot("user")).subscriptions, []);
});

test("V2 read session collects all pages before returning evidence", async () => {
  let calls = 0;
  const session = new RevenueCatV2ReadSession("proj_test", "unit-test-key", async input => {
    calls++;
    const next = String(input).includes("starting_after");
    return Response.json({ object: "list", items: [{ id: next ? "second" : "first" }],
      next_page: next ? null : "/v2/projects/proj_test/customers/user/subscriptions?starting_after=first" });
  }, new AbortController().signal);
  assert.deepEqual((await session.list("/customers/user/subscriptions?limit=100")).map(i => i.id), ["first", "second"]);
  assert.equal(calls, 2);
});

for (const nextPage of ["https://evil.example/subscriptions", "/v2/projects/other/customers/user/subscriptions",
  "/v2/projects/proj_test/customers/user/subscriptions?limit=100"]) {
  test(`V2 rejects foreign or looping pagination: ${nextPage}`, async () => {
    let calls = 0;
    const session = new RevenueCatV2ReadSession("proj_test", "unit-test-key", async () => {
      calls++;
      return Response.json({ object: "list", items: [], next_page: nextPage });
    }, new AbortController().signal);
    await assert.rejects(session.list("/customers/user/subscriptions?limit=100"));
    assert.equal(calls, 1);
  });
}

test("V2 fails closed if product ownership cannot be read", async () => {
  const fixture = fixtureFetcher(async () => Response.json(snapshot()), "app_test");
  const api = new RevenueCatCustomerApi({ secretApiKey: "unit-test-key", projectId: "proj_test", appId: "app_test",
    fetcher: async (input, init) => String(input).includes("/products/")
      ? new Response("forbidden", { status: 403 }) : fixture(input, init) });
  await assert.rejects(api.getSnapshot("user"), { reason: "request_failed", diagnostics: { httpStatus: 403, failureKind: "http_error" } });
});

async function evidenceWithRevenue() {
  const api = new RevenueCatCustomerApi({ secretApiKey: "unit-test-key", projectId: "proj_test", appId: "app_test",
    now: () => new Date("2026-09-24T00:00:00Z"),
    fetcher: fixtureFetcher(async () => Response.json(snapshot()), "app_test") });
  const evidence = await api.getSnapshot("user");
  evidence.subscriptions[0].transactions[0].revenue_in_local_currency = { currency: "USD", gross: 9.99 };
  return evidence;
}

test("customer-wide entitlement cannot extend an owned app subscription", async () => {
  const evidence = await evidenceWithRevenue();
  evidence.activeEntitlements[0].expires_at = Date.parse("2026-12-01");
  const result = normalizeRevenueCatSnapshot(evidence, "user", new Date("2026-09-24"), { allowSandbox: true });
  assert.equal(result.membership.expiresAt, "2026-10-23T10:00:00.000Z");
});

test("ISO week grace duration bounds access without using another app's expiry", async () => {
  const evidence = await evidenceWithRevenue();
  evidence.subscriptions[0].subscription.status = "in_grace_period";
  evidence.subscriptions[0].product.subscription = { grace_period_duration: "P1W" };
  evidence.activeEntitlements[0].expires_at = Date.parse("2026-12-01");
  const result = normalizeRevenueCatSnapshot(evidence, "user", new Date("2026-10-24"), { allowSandbox: true });
  assert.equal(result.membership.state, "grace_period");
  assert.equal(result.membership.expiresAt, "2026-10-30T10:00:00.000Z");
});

test("negative revenue alone is not a timestamped refund event", async () => {
  const evidence = await evidenceWithRevenue();
  evidence.subscriptions[0].transactions[0].revenue_in_local_currency = { currency: "USD", gross: -9.99 };
  const result = normalizeRevenueCatSnapshot(evidence, "user", new Date("2026-09-24"), { allowSandbox: true });
  assert.notEqual(result.transactions[0].status, "refunded");
  assert.equal(result.transactions[0].refundAmountMinor, null);
  assert.equal(result.transactions[0].amountMinor, null);
});

test("positive V2 transaction revenue cannot erase a later refund", async () => {
  const evidence = await evidenceWithRevenue();
  const { transactions } = normalizeRevenueCatSnapshot(evidence, "user", new Date("2026-09-24"), { allowSandbox: true });
  const paid = transactions[0];
  assert.equal(paid.observedAt, paid.purchasedAt);
  const refund = { ...paid, status: "refunded" as const, refundedAt: "2026-09-24T00:00:00.000Z",
    refundAmountMinor: 999, observedAt: "2026-09-24T00:00:00.000Z" };
  for (const records of [[paid, refund, paid], [refund, paid]]) {
    const store = new InMemoryAiNovelBillingStore();
    for (const record of records) store.upsertTransaction(record);
    const [retained] = store.listTransactions("ai_novel", "user");
    assert.equal(retained.status, "refunded");
    assert.equal(retained.refundedAt, refund.refundedAt);
    assert.equal(retained.refundAmountMinor, 999);
  }
});

test("promotional subscription without product does not block supported store subscription", async () => {
  const fixture = fixtureFetcher(async () => Response.json(snapshot()), "app_test");
  const api = new RevenueCatCustomerApi({ secretApiKey: "unit-test-key", projectId: "proj_test", appId: "app_test",
    fetcher: async (input, init) => {
      const response = await fixture(input, init);
      const body = await response.json();
      if (String(input).includes("/customers/user/subscriptions")) body.items.unshift({
        object: "subscription", id: "promotion", customer_id: "user", store: "promotional", product_id: null });
      return Response.json(body);
    } });
  assert.equal((await api.getSnapshot("user")).subscriptions.length, 1);
});

test("overlapping lookups keep start order even if the earlier lookup finishes last", async () => {
  const fixture = fixtureFetcher(async () => Response.json(snapshot()), "app_test");
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let productCalls = 0;
  let productReached!: () => void;
  const reached = new Promise<void>(resolve => { productReached = resolve; });
  const api = new RevenueCatCustomerApi({ secretApiKey: "unit-test-key", projectId: "proj_test", appId: "app_test",
    now: () => new Date("2026-09-24"),
    fetcher: async (input, init) => {
      if (String(input).includes("/products/") && ++productCalls === 1) { productReached(); await blocked; }
      return fixture(input, init);
    } });
  const earlier = api.getSnapshot("user");
  await reached;
  const later = await api.getSnapshot("user");
  release();
  assert.ok((await earlier).observedAt < later.observedAt);
});
