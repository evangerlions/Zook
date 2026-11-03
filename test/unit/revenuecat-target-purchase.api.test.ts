import assert from "node:assert/strict";
import baseTest from "node:test";
import { inBillingEnvironment } from "../../src/modules/billing/billing-environment.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { createApplication } from "../support/create-test-application.ts";
import { fixtureFetcher, snapshot } from "../support/revenuecat-v2-fixtures.ts";

const NOW = new Date("2026-11-03T00:00:00Z");
const FUTURE = "2027-01-01T00:00:00Z";
const PAST = "2026-10-01T00:00:00Z";
const test = (name: string, work: () => Promise<void>) =>
  baseTest(name, () => inBillingEnvironment("sandbox", work));

function providerState({ expired = false, targetAccess = true, pro = false } = {}) {
  return snapshot({
    entitlements: {
      ...(!expired && targetAccess ? { orangewrite_plus: { productKey: "plus_monthly", expiresAt: FUTURE } } : {}),
      ...(pro ? { orangewrite_pro: { productKey: "pro_yearly", expiresAt: FUTURE } } : {}),
    },
    subscriptions: {
      plus_monthly: { store: "app_store", transactionId: "owned-plus", purchasedAt: "2026-09-01T00:00:00Z",
        originalPurchasedAt: "2026-09-01T00:00:00Z", expiresAt: expired ? PAST : FUTURE, sandbox: true },
      ...(pro ? { pro_yearly: { store: "app_store", transactionId: "owned-pro", purchasedAt: "2026-10-01T00:00:00Z",
        originalPurchasedAt: "2026-10-01T00:00:00Z", expiresAt: FUTURE, sandbox: true } } : {}),
    },
  });
}

async function fixture(state = providerState(), options: {
  now?: () => Date;
  afterResponse?: (url: string) => Promise<void>;
} = {}) {
  const seed = buildDefaultSeed();
  seed.appUsers!.push({ id: "target_alice", appId: "ai_novel", userId: "user_alice", status: "ACTIVE",
    accountRegion: "GLOBAL", joinedAt: "2026-09-01T00:00:00Z" });
  const provider = fixtureFetcher(async () => Response.json(state), "rc-app");
  let failProvider = false;
  const runtime = await createApplication({ seed, revenueCat: {
    secretApiKey: "unit-test", projectId: "project", appId: "rc-app", now: options.now ?? (() => NOW),
    fetcher: async (input, init) => {
      if (failProvider) return new Response(null, { status: 503 });
      const response = await provider(input, init);
      const body = await response.json();
      if (String(input).includes("/transactions")) {
        for (const transaction of body.items) transaction.revenue_in_local_currency = { currency: "USD", gross: 9.99 };
      }
      await options.afterResponse?.(String(input));
      return Response.json(body);
    },
  } });
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "ai_novel");
  const sync = async (id = "owned-plus") => {
    const response = await runtime.app.handle({ method: "POST", path: "/api/v1/ai_novel/billing/sync",
      headers: { authorization: `Bearer ${token}`, "x-app-id": "ai_novel" },
      body: { provider: "revenuecat", reason: "retry", purchaseReference: { kind: "store_transaction", id } } });
    assert.equal(response.statusCode, 200);
    return response.body.data;
  };
  return { ...runtime, sync, failProvider: () => { failProvider = true; } };
}

test("paid Plus target completes while the current highest membership remains Pro", async () => {
  const f = await fixture(providerState({ pro: true }));
  try {
    const first = await f.sync();
    assert.deepEqual(first.targetPurchase, { reference: { kind: "store_transaction", id: "owned-plus" },
      status: "paid", entitlementStatus: "applied" });
    assert.equal(first.syncStatus, "complete");
    assert.equal(first.membership.planKey, "pro_yearly");
    assert.equal(first.membership.active, true);
    const repeated = await f.sync();
    assert.deepEqual(repeated.membership, first.membership);
    assert.deepEqual(repeated.targetPurchase, first.targetPurchase);
    assert.equal((await f.database.listAiNovelBillingTransactions("ai_novel", "user_alice")).length, 2);
  } finally { await f.close(); }
});

test("an expired paid target completes without reactivating or extending membership", async () => {
  const f = await fixture(providerState({ expired: true }));
  try {
    const first = await f.sync();
    assert.equal(first.targetPurchase.status, "paid");
    assert.equal(first.targetPurchase.entitlementStatus, "applied");
    assert.equal(first.syncStatus, "complete");
    assert.equal(first.membership.active, false);
    assert.equal(first.membership.expiresAt, PAST.replace("Z", ".000Z"));
    assert.deepEqual((await f.sync()).membership, first.membership);
  } finally { await f.close(); }
});

test("another active Pro subscription is not entitlement proof for the paid Plus target", async () => {
  const f = await fixture(providerState({ targetAccess: false, pro: true }));
  try {
    const result = await f.sync();
    assert.equal(result.targetPurchase.status, "paid");
    assert.equal(result.targetPurchase.entitlementStatus, "pending");
    assert.equal(result.syncStatus, "pending");
    assert.equal(result.membership.planKey, "pro_yearly");
  } finally { await f.close(); }
});

test("a missing target or provider outage cannot borrow an existing membership", async () => {
  const f = await fixture();
  try {
    await f.sync();
    const missing = await f.sync("unknown-transaction");
    assert.equal(missing.targetPurchase.status, "pending");
    assert.equal(missing.targetPurchase.entitlementStatus, "pending");
    f.failProvider();
    const unavailable = await f.sync();
    assert.equal(unavailable.targetPurchase.status, "pending");
    assert.equal(unavailable.syncStatus, "pending");
    assert.equal(unavailable.membership.active, true);
  } finally { await f.close(); }
});

test("a paid App Store target is blocked while an active Google membership is preserved", async () => {
  const f = await fixture();
  try {
    await f.database.upsertAiNovelBillingMembership({ appId: "ai_novel", userId: "user_alice", active: true,
      state: "active", tier: "pro", planKey: "pro_yearly", expiresAt: FUTURE, source: "play_store",
      autoRenew: false, managementUrl: null, lastSyncedAt: NOW.toISOString(), accountDeletedAt: null });
    const result = await f.sync();
    assert.equal(result.targetPurchase.status, "paid");
    assert.equal(result.targetPurchase.entitlementStatus, "blocked");
    assert.equal(result.syncStatus, "pending");
    assert.equal(result.membership.source, "play_store");
  } finally { await f.close(); }
});

for (const status of ["refunded", "revoked"] as const) {
  test(`a trusted ${status} record cannot become a successful target from an older RC snapshot`, async () => {
    const f = await fixture();
    try {
      await f.sync();
      const transaction = (await f.database.listAiNovelBillingTransactions("ai_novel", "user_alice"))[0];
      await f.database.upsertAiNovelBillingTransaction({ ...transaction, status,
        refundedAt: NOW.toISOString(), observedAt: new Date(NOW.getTime() + 1000).toISOString() });
      const result = await f.sync();
      assert.equal(result.targetPurchase.entitlementStatus, "blocked");
      assert.equal((await f.database.listAiNovelBillingTransactions("ai_novel", "user_alice"))[0].status, status);
    } finally { await f.close(); }
  });
}

test("another environment's paid transaction cannot confirm the target", async () => {
  const state = providerState();
  state.subscriptions.plus_monthly.sandbox = false;
  const f = await fixture(state);
  try {
    const result = await f.sync();
    assert.equal(result.targetPurchase.status, "pending");
    assert.equal(result.membership.active, false);
    assert.equal((await f.database.listAiNovelBillingTransactions("ai_novel", "user_alice")).length, 0);
  } finally { await f.close(); }
});

test("an elapsed paid App Store target completes after a legitimate later channel switch", async () => {
  const f = await fixture(providerState({ expired: true }));
  try {
    await f.database.upsertAiNovelBillingMembership({ appId: "ai_novel", userId: "user_alice", active: true,
      state: "active", tier: "pro", planKey: "pro_yearly", expiresAt: FUTURE, source: "play_store",
      autoRenew: true, managementUrl: null, lastSyncedAt: NOW.toISOString(), accountDeletedAt: null });
    const result = await f.sync();
    assert.equal(result.targetPurchase.entitlementStatus, "applied");
    assert.equal(result.syncStatus, "complete");
    assert.equal(result.membership.source, "play_store");
    assert.equal(result.membership.expiresAt, FUTURE);
  } finally { await f.close(); }
});

test("a slow older active snapshot cannot confirm a target after newer access evidence revoked it", async () => {
  const state = providerState();
  let time = NOW;
  let blocked = false;
  let start!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(state, { now: () => time, afterResponse: async url => {
    if (url.includes("/transactions") && !blocked) { blocked = true; start(); await hold; }
  } });
  try {
    const earlier = f.sync();
    await started;
    time = new Date(NOW.getTime() + 1000);
    state.entitlements = {};
    const newer = await f.sync();
    assert.equal(newer.membership.active, false);
    assert.equal(newer.targetPurchase.entitlementStatus, "pending");
    release();
    const late = await earlier;
    assert.equal(late.targetPurchase.status, "paid");
    assert.equal(late.targetPurchase.entitlementStatus, "pending");
    assert.equal(late.membership.active, false);
  } finally { release(); await f.close(); }
});
