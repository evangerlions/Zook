import assert from "node:assert/strict";
import test from "node:test";
import { BodyLogRewardLedger } from "../../src/modules/bodylog/bodylog-reward-ledger.ts";
import { InMemoryBodyLogRetentionStore } from "../../src/infrastructure/bodylog-retention-store.ts";
import { InMemoryBodyLogSubscriptionStore } from "../../src/modules/bodylog/bodylog-stores.ts";

const paid = {
  id: "ledger-paid-subscription", appId: "bodylog", userId: "ledger-user", tier: "plus" as const,
  startedAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-10-10T00:00:00.000Z",
  originalTransactionId: "ledger-transaction", autoRenew: true,
  createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
};

test("queued promotional reward becomes active exactly at paid expiry and expires exactly at its end", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-09T00:00:00.000Z") });
  const store = new InMemoryBodyLogRetentionStore();
  const subscriptions = new InMemoryBodyLogSubscriptionStore();
  subscriptions.upsertUserSubscription(paid);
  const ledger = new BodyLogRewardLedger(store, subscriptions);
  const grant = await ledger.grant("ledger-user", "invitation", "reward-boundary", "premium", "1_day_premium", 1);
  assert.equal(grant.startsAt, paid.expiresAt);
  assert.equal(grant.endsAt, "2026-10-11T00:00:00.000Z");
  let state = await ledger.entitlements("ledger-user");
  assert.equal(state.promotional[0].status, "queued");
  assert.deepEqual(state.effective, { isPremium: true, sources: ["subscription"], premiumUntil: grant.endsAt });
  t.mock.timers.tick(86_400_000);
  state = await ledger.entitlements("ledger-user");
  assert.equal(state.promotional[0].status, "active");
  assert.deepEqual(state.effective, { isPremium: true, sources: ["invitation"], premiumUntil: grant.endsAt });
  t.mock.timers.tick(86_400_000);
  state = await ledger.entitlements("ledger-user");
  assert.equal(state.promotional[0].status, "expired");
  assert.deepEqual(state.effective, { isPremium: false, sources: [], premiumUntil: null });
});

test("shortened paid entitlement cannot bridge a future promotional gap with a later premiumUntil", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-01T00:00:00.000Z") });
  const subscriptions = new InMemoryBodyLogSubscriptionStore();
  subscriptions.upsertUserSubscription(paid);
  const ledger = new BodyLogRewardLedger(new InMemoryBodyLogRetentionStore(), subscriptions);
  const grant = await ledger.grant("ledger-user", "campaign", "reward-before-shortening", "premium", "1_day_premium", 1);
  assert.equal(grant.startsAt, "2026-10-10T00:00:00.000Z");
  // A later authoritative purchase sync can replace the paid expiry. The
  // already-issued reward keeps its future interval and is still queued.
  subscriptions.upsertUserSubscription({ ...paid, expiresAt: "2026-10-03T00:00:00.000Z" });
  const state = await ledger.entitlements("ledger-user");
  assert.equal(state.promotional[0].status, "queued");
  assert.equal(state.effective.isPremium, true);
  assert.equal(state.effective.premiumUntil, "2026-10-03T00:00:00.000Z", "Only a contiguous current interval may extend current Premium access");
});

test("confirmed campaign claim remains replayable after the campaign closes", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-01T00:00:00.000Z") });
  const { InMemoryDatabase } = await import("../../src/testing/in-memory-database.ts");
  const { BodyLogCampaignService } = await import("../../src/modules/bodylog/bodylog-campaign.service.ts");
  const definition = { id: "expiry-replay", status: "active", title: "Share", subtitle: "Share a real experience",
    startsAt: "2026-09-30T00:00:00.000Z", endsAt: "2026-10-01T01:00:00.000Z",
    reward: { type: "premium", durationDays: 1, displayText: "1 day Premium" }, rules: ["Public original post"],
    platformPolicy: { allowedPlatforms: ["other"], freeFormAllowed: true, oauthPlatforms: [], manualReviewPlatforms: ["other"] } };
  const database = new InMemoryDatabase({ appConfigs: [{ id: "campaign-replay-config", appId: "bodylog", configKey: "bodylog.campaigns", configValue: JSON.stringify([definition]), updatedAt: new Date().toISOString() }] });
  const store = new InMemoryBodyLogRetentionStore();
  const ledger = new BodyLogRewardLedger(store, new InMemoryBodyLogSubscriptionStore());
  const campaigns = new BodyLogCampaignService(database, store, ledger);
  await campaigns.join("ledger-user", definition.id);
  await campaigns.submit("ledger-user", definition.id, { platform: "other", url: "https://example.com/public-review" });
  await campaigns.review("ledger-user", definition.id, true, "trusted-reviewer");
  const confirmation = await campaigns.claim("ledger-user", definition.id);
  t.mock.timers.tick(2 * 60 * 60 * 1000);
  const replay = await campaigns.claim("ledger-user", definition.id);
  assert.deepEqual(replay.reward, confirmation.reward, "Retry should confirm the already-issued grant after response loss");
  assert.equal((await ledger.grants("ledger-user")).length, 1);
});

test("social milestone rewards use the independent ledger and never mutate a paid purchase record", async t => {
  t.mock.timers.enable({apis:["Date"],now:new Date("2026-10-01T00:00:00Z")});
  const {SubscriptionService,SubscriptionTier}=await import("../../src/services/subscription.service.ts");
  const subscriptions=new InMemoryBodyLogSubscriptionStore();subscriptions.upsertUserSubscription(paid);
  const ledger=new BodyLogRewardLedger(new InMemoryBodyLogRetentionStore(),subscriptions);
  const service=new SubscriptionService(subscriptions,ledger);
  const source={source:"buddy" as const,id:"pair-gold-milestone"};
  await service.grantReward("bodylog","ledger-user",SubscriptionTier.PLUS,1,"BodyLog buddy tier reward",source);
  await service.grantReward("bodylog","ledger-user",SubscriptionTier.PLUS,1,"BodyLog buddy tier reward",source);
  assert.equal(subscriptions.findActiveUserSubscription("bodylog","ledger-user")?.expiresAt,paid.expiresAt);
  assert.equal((await ledger.grants("ledger-user")).length,1);
  assert.equal((await ledger.grants("ledger-user"))[0].source,"buddy");
  assert.equal(await service.isPremium("bodylog","ledger-user"),true);
});
