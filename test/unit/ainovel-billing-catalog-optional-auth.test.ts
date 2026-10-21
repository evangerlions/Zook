import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";

test("catalog exposes public prices without membership reads; UserInfo owns personal restrictions", async () => {
  const seed = buildDefaultSeed();
  seed.appUsers!.push({ id: "catalog_alice", appId: "ai_novel", userId: "user_alice",
    status: "ACTIVE", accountRegion: "CN", joinedAt: new Date().toISOString() });
  const runtime = await createApplication({ seed, alipay: { enabled: true, environment: "sandbox",
    appId: "test_merchant", notifyUrl: "https://test.example/notify", returnUrl: "https://test.example/return",
    gateway: { payment: async () => { throw new Error("Not a checkout"); }, query: async () => ({}), verifyNotify: async () => false } } });
  await runtime.database.upsertAiNovelBillingMembership({ appId: "ai_novel", userId: "user_alice",
    active: true, state: "active", tier: "plus", source: "app_store", planKey: "plus_monthly",
    expiresAt: "2099-01-01T00:00:00Z", autoRenew: true, managementUrl: null, accountDeletedAt: null,
    lastSyncedAt: new Date().toISOString() });
  const headers = { "x-app-id": "ai_novel", "x-app-region": "CN" };
  const catalog = (authorization?: string) => runtime.app.handle({ method: "GET",
    path: "/api/v1/ai_novel/billing/catalog", headers: { ...headers,
      ...(authorization === undefined ? {} : { authorization }) },
    query: { platform: "web", distribution: "web" } });
  const originalGetMembership = runtime.services.aiNovelBillingService.getMembership;
  runtime.services.aiNovelBillingService.getMembership = async () => {
    throw new Error("Guest catalog must not read membership");
  };
  const guest = await catalog();
  assert.equal(guest.statusCode, 200);
  assert.equal(guest.body.data.products.length, 6);
  const offer = guest.body.data.products[0].providers[0];
  assert.deepEqual(offer.price, { amountMinor: 3800, currency: "CNY" });
  assert.equal(offer.available, true);
  assert.equal(offer.blockedReason, null);
  assert.equal(Object.hasOwn(guest.body.data, "membership"), false);
  assert.equal(Object.hasOwn(guest.body.data, "userId"), false);
  assert.equal(guest.headers?.["cache-control"], "no-store");
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "ai_novel");
  const member = await catalog(`Bearer ${token}`);
  assert.equal(member.statusCode, 200);
  assert.deepEqual(member.body.data, guest.body.data);
  runtime.services.aiNovelBillingService.getMembership = originalGetMembership;
  const userInfo = await runtime.app.handle({ method: "GET", path: "/api/v1/users/me",
    headers: { ...headers, authorization: `Bearer ${token}` } });
  assert.equal(userInfo.statusCode, 200);
  assert.equal(userInfo.body.data.membership.active, true);
  assert.equal(userInfo.body.data.membership.source, "app_store");
  assert.equal(Date.parse(userInfo.body.data.membership.expiresAt) > Date.now(), true);
  assert.equal((await catalog("Bearer invalid")).statusCode, 401);
  assert.equal((await catalog("")).statusCode, 401);
  const foreign = runtime.services.tokenService.issueAccessToken("user_alice", "frogsleep");
  assert.equal((await catalog(`Bearer ${foreign}`)).statusCode, 403);
  const defaultRegion = await runtime.app.handle({ method: "GET",
    path: "/api/v1/ai_novel/billing/catalog", headers: { "x-app-id": "ai_novel" },
    query: { platform: "web", distribution: "web" } });
  assert.equal(defaultRegion.statusCode, 200);
  assert.equal(defaultRegion.body.data.accountRegion, "GLOBAL");
  for (const [extraHeaders, status] of [
    [{ "x-app-region": "invalid" }, 400],
    [{ "x-app-id": "frogsleep" }, 403],
  ] as const) {
    const rejected = await runtime.app.handle({ method: "GET",
      path: "/api/v1/ai_novel/billing/catalog", headers: { ...headers, ...extraHeaders },
      query: { platform: "web", distribution: "web" } });
    assert.equal(rejected.statusCode, status);
  }
  for (const [method, path] of [["POST", "/api/v1/ai_novel/billing/sync"],
    ["POST", "/api/v1/ai_novel/billing/alipay/orders"],
    ["GET", "/api/v1/ai_novel/billing/alipay/orders/unknown"]] as const) {
    assert.equal((await runtime.app.handle({ method, path, headers })).statusCode, 401);
  }
});
