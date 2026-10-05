import assert from "node:assert/strict";
import test from "node:test";
import { buildAiNovelBillingCatalog } from "../../src/modules/billing/ainovel-billing-catalog.ts";
import { selectStoreMembership, storeSnapshotConflicts } from "../../src/modules/billing/billing-channel-policy.ts";
import type { AiNovelBillingMembershipRecord, AiNovelBillingSource } from "../../src/shared/types.ts";
import type { NormalizedRevenueCatSnapshot } from "../../src/modules/billing/ainovel-revenuecat-normalizer.ts";
import { runBillingSync } from "../../src/services/ainovel-billing-sync.ts";
import { StructuredLogger } from "../../src/infrastructure/logging/pino-logger.module.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { fixtureFetcher, snapshot as providerFixture } from "../support/revenuecat-v2-fixtures.ts";
import { normalizeRevenueCatSnapshot } from "../../src/modules/billing/ainovel-revenuecat-normalizer.ts";

const now = new Date("2026-10-05T00:00:00Z");
function membership(source: AiNovelBillingSource): AiNovelBillingMembershipRecord {
  return { appId: "ai_novel", userId: "user_alice", active: true, source, state: "cancelled",
    tier: "plus", planKey: "plus_monthly", expiresAt: "2026-10-23T00:00:00Z",
    autoRenew: false, managementUrl: null, lastSyncedAt: now.toISOString(), accountDeletedAt: null };
}
function snapshot(source: AiNovelBillingSource): NormalizedRevenueCatSnapshot {
  const current = membership(source);
  return { membership: current, activeMemberships: [current], transactions: [],
    ignoredEntitlementCount: 0, ignoredProductCount: 0, hasActiveUnverifiedEnvironmentEntitlement: false };
}

test("catalog blocks all six cross-channel combinations but permits the same channel", () => {
  for (const current of ["app_store", "play_store", "alipay"] as const) {
    for (const target of ["app_store", "play_store", "alipay"] as const) {
      const input = target === "app_store" ? { accountRegion: "CN", platform: "ios", distribution: "app_store" } as const
        : target === "play_store" ? { accountRegion: "GLOBAL", platform: "android", distribution: "google_play" } as const
          : { accountRegion: "CN", platform: "web", distribution: "web" } as const;
      const catalog = buildAiNovelBillingCatalog({ ...input, activeMembershipSource: current, alipayAvailable: true,
        alipayPrices: { plus_monthly: 3800, plus_quarterly: 9800, plus_yearly: 29800, pro_monthly: 8800, pro_quarterly: 22800, pro_yearly: 59800 } });
      for (const product of catalog.products) {
        assert.equal(product.providers[0].available, current === target);
        assert.equal(product.providers[0].blockedReason, current === target ? null : "active_membership_managed_elsewhere");
      }
    }
  }
  const direct = buildAiNovelBillingCatalog({ accountRegion: "GLOBAL", platform: "android", distribution: "direct_android", activeMembershipSource: "app_store" });
  assert.equal(direct.products[0].providers[0].available, false);
});

test("cancelled-but-unexpired access prevents RC channel takeover, expired access allows switching", () => {
  for (const currentSource of ["app_store", "play_store", "alipay"] as const) {
    for (const incomingSource of ["app_store", "play_store"] as const) {
      const current = membership(currentSource), incoming = snapshot(incomingSource);
      const selected = selectStoreMembership(incoming, current, now);
      assert.equal(selected.source, currentSource);
      assert.equal(storeSnapshotConflicts(incoming, selected), currentSource !== incomingSource);
      const expired = { ...current, expiresAt: "2026-10-04T00:00:00Z" };
      assert.equal(selectStoreMembership(incoming, expired, now).source, incomingSource);
    }
  }
});

test("a higher tier in another store never steals the established store; same-store updates work", () => {
  const current = membership("app_store");
  const incoming = snapshot("play_store"); incoming.membership.tier = "pro";
  incoming.activeMemberships = [incoming.membership, { ...current, planKey: "plus_yearly" }];
  const selected = selectStoreMembership(incoming, current, now);
  assert.equal(selected.source, "app_store"); assert.equal(selected.planKey, "plus_yearly");
  assert.equal(storeSnapshotConflicts(incoming, selected), true);
  const same = snapshot("app_store"); same.membership.tier = "pro";
  assert.equal(selectStoreMembership(same, current, now).tier, "pro");
});

test("confirmation of the same plan in another store is pending, not successful", async () => {
  const result = await runBillingSync({ userId: "user_alice", requestId: "channel_test", reason: "purchase" }, {
    logger: new StructuredLogger("test", { emitToConsole: false }), fetchSnapshot: async () => snapshot("app_store"),
    persistSnapshot: async () => {}, getMembership: async () => membership("play_store"),
  });
  assert.equal(result.syncStatus, "pending"); assert.equal(result.membership.source, "play_store");
});

test("explicit original-store revocation permits switching before cached expiry; absence does not", () => {
  for (const [previous, next] of [["app_store", "play_store"], ["play_store", "app_store"]] as const) {
    const current = membership(previous), incoming = snapshot(next);
    assert.equal(selectStoreMembership(incoming, current, now).source, previous);
    assert.equal(selectStoreMembership({ ...incoming, activeMemberships: [], observedMemberships: [],
      membership: { ...incoming.membership, active: false, source: null, state: "free" } }, current, now), current);
    assert.equal(selectStoreMembership({ ...incoming, activeMemberships: [], observedMemberships: [],
      membership: { ...incoming.membership, active: false, source: null, state: "free" } }, current, now, true).active, false);
    incoming.observedMemberships = [{ ...current, active: false, state: "expired", tier: null, planKey: null }, incoming.membership];
    const selected = selectStoreMembership(incoming, current, now);
    assert.equal(selected.source, next); assert.equal(storeSnapshotConflicts(incoming, selected), false);
  }
});

test("normalization retains explicit revoked store evidence for both switch directions", () => {
  for (const [previous, next] of [["app_store", "play_store"], ["play_store", "app_store"]] as const) {
    const normalized = normalizeRevenueCatSnapshot({ observedAt: now.toISOString(),
      activeEntitlements: [{ entitlement_id: "plus", expires_at: Date.parse("2026-10-23T00:00:00Z") }],
      subscriptions: [previous, next].map((source, index) => ({
        subscription: { store: source, gives_access: index === 1, environment: "sandbox",
          status: index === 1 ? "active" : "expired", auto_renewal_status: "will_not_renew",
          current_period_ends_at: Date.parse("2026-10-23T00:00:00Z") },
        product: { store_identifier: source === "app_store" ? "plus_monthly" : "plus_monthly:auto-renew" },
        entitlements: [{ id: "plus", lookup_key: "orangewrite_plus" }], transactions: [],
      })),
    }, "user_alice", now, { allowSandbox: true });
    assert.equal(normalized.observedMemberships?.find(item => item.source === previous)?.active, false);
    const selected = selectStoreMembership(normalized, membership(previous), now);
    assert.equal(selected.source, next);
    assert.equal(storeSnapshotConflicts(normalized, selected), false);
  }
});

test("trusted transfer releases store access but protects Alipay and active same-store access", () => {
  const empty = snapshot("app_store");
  empty.activeMemberships = [];
  empty.membership = { ...empty.membership, active: false, source: null, state: "free" };
  assert.equal(selectStoreMembership(empty, membership("app_store"), now, true).active, false);
  const alipay = membership("alipay");
  assert.equal(selectStoreMembership(empty, alipay, now, true), alipay);
  const sameStore = snapshot("app_store");
  assert.equal(selectStoreMembership(sameStore, membership("app_store"), now, true).active, true);
  assert.equal(selectStoreMembership(sameStore, membership("app_store"), now, true).source, "app_store");
});

test("real sync persists cross-store financial evidence, protects membership and logs conflict", async () => {
  const seed = buildDefaultSeed();
  seed.appUsers!.push({ id: "channel_alice", appId: "ai_novel", userId: "user_alice", status: "ACTIVE", accountRegion: "GLOBAL", joinedAt: now.toISOString() });
  const runtime = await createApplication({ seed, revenueCat: { secretApiKey: "mock", projectId: "mock", appId: "apple_app",
    googleAppId: "google_app", allowSandbox: true, now: () => now,
    fetcher: fixtureFetcher(async () => Response.json(providerFixture()), "apple_app") } });
  await runtime.database.upsertAiNovelBillingMembership(membership("play_store"));
  const result = await runtime.services.aiNovelBillingService.sync({ userId: "user_alice", requestId: "channel_real_sync", reason: "purchase" });
  assert.equal(result.syncStatus, "pending"); assert.equal(result.membership.source, "play_store");
  const financial = await runtime.database.listAiNovelBillingTransactions("ai_novel", "user_alice");
  assert.equal(financial.length, 1); assert.equal(financial[0].source, "app_store");
  assert.ok(runtime.logger.records.some(record => record.status === "provider_conflict"));
  await runtime.database.upsertAiNovelBillingMembership({ ...membership("play_store"), expiresAt: "2026-10-04T00:00:00Z" });
  assert.equal((await runtime.services.aiNovelBillingService.sync({ userId: "user_alice", requestId: "channel_expired" })).membership.source, "app_store");
});
