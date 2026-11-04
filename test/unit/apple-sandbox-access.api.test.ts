import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { inBillingEnvironment } from "../../src/modules/billing/billing-environment.ts";
import { createApplication } from "../support/create-test-application.ts";
import { fixtureFetcher, snapshot } from "../support/revenuecat-v2-fixtures.ts";

function unexpired(evidence: ReturnType<typeof snapshot>) {
  for (const item of Object.values(evidence.entitlements)) item.expiresAt = "2099-01-01T00:00:00Z";
  for (const item of Object.values(evidence.subscriptions)) item.expiresAt = "2099-01-01T00:00:00Z";
  return evidence;
}

async function fixture(t: TestContext, listed = true, deployment = "online", accountRegion: "GLOBAL" | "CN" = "GLOBAL") {
  const seed = buildDefaultSeed();
  seed.users!.find(user => user.id === "user_alice")!.phone = "+8618710100901";
  seed.appUsers!.push({ id: "review_user", appId: "ai_novel", userId: "user_alice", status: "ACTIVE", accountRegion, joinedAt: "2026-09-23T00:00:00Z" });
  let evidence = unexpired(snapshot());
  const provider = fixtureFetcher(async () => Response.json(evidence), "app_test");
  const runtime = await createApplication({ seed, appEnvironment: deployment,
    revenueCat: { secretApiKey: "fixture-only", projectId: "proj_test", appId: "app_test", googleAppId: "google_test",
      webhookAuthorization: "Bearer fixture-webhook",
      fetcher: async (input, init) => {
        const response = await provider(input, init);
        const data = await response.json();
        if (String(input).includes("/transactions")) {
          for (const tx of data.items) tx.revenue_in_local_currency = { currency: "USD", gross: 9.99 };
        }
        return Response.json(data);
      } } });
  t.after(() => runtime.close());
  const registry = runtime.services.commonTestAccountService;
  const configure = async (enabled: boolean, appId = "ai_novel") => {
    const existing = (await registry.getDocument()).items.find(item => item.appId === appId && item.phone === "+8618710100901");
    const input = { appId, phoneNa: "+86", phone: "18710100901", label: "Review fixture", enabled };
    return existing ? registry.update(existing.id, input) : registry.create(input);
  };
  if (listed) await configure(true);
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "ai_novel");
  const request = (path: string, platform = "ios", body?: unknown, extra = {}) => runtime.app.handle({
    method: body ? "POST" : "GET", path, body,
    headers: { authorization: `Bearer ${token}`, "x-app-id": "ai_novel", "x-platform": platform, "x-billing-environment": "production", ...extra },
  });
  const sync = (platform = "ios", extra = {}) => request("/api/v1/ai_novel/billing/sync", platform, { provider: "revenuecat", reason: "restore" }, extra);
  return { ...runtime, configure, request, sync, setEvidence: (next: typeof evidence) => { evidence = unexpired(next); } };
}

test("listed Apple review account synchronizes and reads sandbox membership without opening production", async t => {
  const f = await fixture(t);
  const result = await f.sync();
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.data.syncStatus, "complete");
  assert.equal(result.body.data.membership.active, true);
  assert.equal((await f.request("/api/v1/users/me")).body.data.membership.active, true);
  assert.equal(await f.database.findAiNovelBillingMembership("ai_novel", "user_alice"), undefined);
  assert.equal((await inBillingEnvironment("sandbox", () => f.database.findAiNovelBillingMembership("ai_novel", "user_alice")))?.active, true);
});

test("empty allowlist and forged sandbox headers cannot unlock review access", async t => {
  const f = await fixture(t, false);
  assert.equal((await f.sync()).body.data.membership.active, false);
  const forged = await f.sync("ios", { "x-billing-environment": "sandbox" });
  assert.equal(forged.statusCode, 403);
  assert.equal(forged.body.code, "BILLING_ENVIRONMENT_FORBIDDEN");
});

test("Web and Android never inherit an Apple account's sandbox membership", async t => {
  const f = await fixture(t);
  await f.sync();
  for (const platform of ["web", "android", "windows"]) {
    const result = await f.request("/api/v1/users/me", platform);
    assert.equal(result.body.data.membership.active, false);
  }
});

test("removing an allowed user immediately stops sandbox admission", async t => {
  const f = await fixture(t);
  await f.sync();
  await f.configure(false);
  assert.equal((await f.request("/api/v1/users/me")).body.data.membership.active, false);
});

test("allowlisting does not substitute for RevenueCat's active entitlement", async t => {
  const f = await fixture(t);
  f.setEvidence(snapshot({ entitlements: {} }));
  assert.equal((await f.sync()).body.data.membership.active, false);
});

test("a purchase is confirmed once and consumes only sandbox membership and credits", async t => {
  const f = await fixture(t);
  const purchase = () => f.request("/api/v1/ai_novel/billing/sync", "ios", { provider: "revenuecat", reason: "purchase",
    purchaseReference: { kind: "store_transaction", id: "tx_plus_001" } });
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await purchase();
    assert.equal(result.body.data.syncStatus, "complete");
    assert.equal(result.body.data.targetPurchase.entitlementStatus, "applied");
  }
  const sandbox = await f.request("/api/v1/ai_novel/credits");
  const production = await f.request("/api/v1/ai_novel/credits", "web");
  assert.equal(sandbox.body.data.tier, "plus");
  assert.equal(production.body.data.tier, "free");
  const transactions = await f.database.listAiNovelBillingTransactions("ai_novel", "user_alice");
  assert.equal(transactions.filter(tx => tx.isSandbox === true).length, 1);
  assert.equal(transactions.filter(tx => tx.isSandbox === false).length, 0);
});

test("RevenueCat revoking a tester entitlement removes sandbox access on synchronization", async t => {
  const f = await fixture(t);
  await f.sync();
  f.setEvidence(snapshot({ entitlements: {} }));
  assert.equal((await f.sync()).body.data.membership.active, false);
  assert.equal((await f.request("/api/v1/users/me")).body.data.membership.active, false);
});

test("macOS review purchases use the same isolated Apple flow", async t => {
  const f = await fixture(t);
  assert.equal((await f.sync("macos")).body.data.membership.active, true);
  assert.equal((await f.request("/api/v1/users/me", "macos")).body.data.membership.active, true);
});

test("online Google sandbox notifications stay ignored for listed Apple testers", async t => {
  const f = await fixture(t);
  const result = await f.app.handle({ method: "POST", path: "/api/v1/ai_novel/billing/webhooks/revenuecat",
    headers: { authorization: "Bearer fixture-webhook" }, body: { api_version: "1.0", event: { id: "google_sandbox", type: "INITIAL_PURCHASE",
      app_id: "google_test", app_user_id: "user_alice", store: "PLAY_STORE", environment: "SANDBOX",
      product_id: "plus_monthly:auto-renew", transaction_id: "google_tx", event_timestamp_ms: Date.parse("2026-09-24T00:00:00Z") } } });
  assert.equal(result.body.data.status, "ignored");
  assert.equal(await inBillingEnvironment("sandbox", () => f.database.findAiNovelBillingMembership("ai_novel", "user_alice")), undefined);
});

test("active production membership takes priority for an allowed Apple account", async t => {
  const f = await fixture(t);
  const evidence = snapshot();
  evidence.subscriptions.plus_monthly.sandbox = false;
  f.setEvidence(evidence);
  // Establish production through the same sync path before enabling test access.
  await f.configure(false);
  await f.sync();
  await f.configure(true);
  assert.equal((await f.request("/api/v1/users/me")).body.data.membership.active, true);
  assert.equal((await f.database.findAiNovelBillingMembership("ai_novel", "user_alice"))?.active, true);
  assert.equal(await inBillingEnvironment("sandbox", () => f.database.findAiNovelBillingMembership("ai_novel", "user_alice")), undefined);
});

test("a listed tester's first real App Store purchase is still synchronized into production", async t => {
  const f = await fixture(t);
  const evidence = snapshot();
  evidence.subscriptions.plus_monthly.sandbox = false;
  f.setEvidence(evidence);
  const result = await f.sync();
  assert.equal(result.body.data.syncStatus, "complete");
  assert.equal(result.body.data.membership.active, true);
  assert.equal((await f.database.findAiNovelBillingMembership("ai_novel", "user_alice"))?.active, true);
  assert.equal(await inBillingEnvironment("sandbox", () => f.database.findAiNovelBillingMembership("ai_novel", "user_alice")), undefined);
});

test("an obsolete user-ID list cannot grant access and is removed from saved/public config", async t => {
  const f = await fixture(t, false);
  const admin = f.services.adminConsoleService;
  const saved = await admin.updateConfig("ai_novel", JSON.stringify({ billing: { revenueCat: { sandboxAppUserIds: ["user_alice"] } } }));
  assert.equal(saved.rawJson.includes("sandboxAppUserIds"), false);
  assert.equal((await f.sync()).body.data.membership.active, false);
  const response = await f.request("/api/v1/ai_novel/public/config", "web");
  assert.equal(JSON.stringify(response.body.data).includes("18710100901"), false);
  assert.equal(JSON.stringify(response.body.data).includes("user_alice"), false);
});

test("SMS registry additions and deletions apply without copying user IDs", async t => {
  const f = await fixture(t, false);
  assert.equal((await f.sync()).body.data.membership.active, false);
  const document = await f.configure(true);
  assert.equal((await f.sync()).body.data.membership.active, true);
  await f.services.commonTestAccountService.delete(document.items[0].id);
  assert.equal((await f.request("/api/v1/users/me")).body.data.membership.active, false);
});

test("another application's SMS test account never grants AINovel sandbox access", async t => {
  const f = await fixture(t, false);
  await f.configure(true, "app_a");
  assert.equal((await f.sync()).body.data.membership.active, false);
});

test("only the authenticated user's server-side phone is matched", async t => {
  const f = await fixture(t);
  const token = f.services.tokenService.issueAccessToken("user_bob", "ai_novel");
  await f.services.appRegistryService.ensureMembership("ai_novel", "user_bob");
  const response = await f.request("/api/v1/users/me", "ios", undefined, {
    authorization: `Bearer ${token}`, "x-phone": "+8618710100901",
  });
  assert.equal(response.body.data.membership.active, false);
});

test("unknown deployments never enable Apple sandbox access", async t => {
  const f = await fixture(t, true, "unknown");
  assert.equal((await f.sync()).body.data.membership.active, false);
});

test("Apple sandbox webhook uses canonical projection only for allowed users", async t => {
  const f = await fixture(t);
  const event = { api_version: "1.0", event: { id: "review_initial", type: "INITIAL_PURCHASE", app_id: "app_test", app_user_id: "user_alice",
    store: "APP_STORE", environment: "SANDBOX", product_id: "plus_monthly", transaction_id: "tx_review", event_timestamp_ms: Date.parse("2026-09-24T00:00:00Z") } };
  const send = () => f.app.handle({ method: "POST", path: "/api/v1/ai_novel/billing/webhooks/revenuecat", headers: { authorization: "Bearer fixture-webhook" }, body: event });
  assert.equal((await send()).body.data.status, "processed");
  assert.equal((await f.request("/api/v1/users/me")).body.data.membership.active, true);
  assert.equal((await send()).body.data.status, "duplicate");
  assert.equal(await f.database.findAiNovelBillingMembership("ai_novel", "user_alice"), undefined);
});

test("approved Apple sandbox users can load store catalog without Alipay sandbox credentials", async t => {
  for (const region of ["CN", "GLOBAL"] as const) {
    const f = await fixture(t, true, "online", region);
    const token = f.services.tokenService.issueAccessToken("user_alice", "ai_novel");
    for (const platform of ["ios", "macos"]) {
      const result = await f.app.handle({
        method: "GET", path: "/api/v1/ai_novel/billing/catalog",
        query: { platform, distribution: "app_store" },
        headers: { authorization: `Bearer ${token}`, "x-app-id": "ai_novel", "x-platform": platform,
          "x-billing-environment": "production" },
      });
      assert.equal(result.statusCode, 200);
      assert.equal(result.body.data.products.length, 6);
      assert.ok(result.body.data.products.every(product => product.providers.every(provider =>
        provider.provider === "revenuecat" && provider.available)));
    }
  }
});
