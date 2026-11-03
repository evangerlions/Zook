import assert from "node:assert/strict";
import baseTest, { type TestContext } from "node:test";
import { inBillingEnvironment } from "../../src/modules/billing/billing-environment.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import type { AlipayOrder } from "../../src/modules/billing/alipay-models.ts";
import type { AlipayPrices } from "../../src/modules/billing/ainovel-alipay-pricing.ts";
import { createApplication } from "../support/create-test-application.ts";
import { TEST_ALIPAY_PRICES, seedAlipayPrices } from "../support/alipay-pricing-fixture.ts";

const test = (name: string, work: (t: TestContext) => Promise<void>) =>
  baseTest(name, t => inBillingEnvironment("sandbox", () => work(t)));
const NOW = new Date("2026-11-03T10:00:00Z");

async function fixture(t: TestContext, configured = true) {
  const seed = buildDefaultSeed();
  if (configured) seedAlipayPrices(seed);
  seed.appUsers!.push({ id: "pricing_alice", appId: "ai_novel", userId: "user_alice",
    status: "ACTIVE", accountRegion: "CN", joinedAt: NOW.toISOString() });
  const orders = new Map<string, AlipayOrder>();
  const evidence = (id: string) => ({ code: "10000", out_trade_no: id, app_id: "merchant", seller_id: "seller",
    trade_no: "202611030000000001", trade_status: "TRADE_SUCCESS", total_amount: (orders.get(id)!.amountMinor / 100).toFixed(2),
    send_pay_date: "2026-11-03 18:00:00", sign_type: "RSA2", sign: "fixture" });
  const runtime = await createApplication({ seed, alipay: { sandbox: { appId: "merchant", sellerId: "seller", now: () => NOW,
    gateway: { payment: async order => { orders.set(order.orderId, order); return { type: "page", url: "https://cashier.example.test" }; },
      query: async id => evidence(id), verifyNotify: async () => true } } } });
  t.after(() => runtime.close());
  const admin = runtime.services.adminConsoleService;
  const headers = { "x-app-id": "ai_novel", authorization: `Bearer ${runtime.services.tokenService.issueAccessToken("user_alice", "ai_novel")}` };
  const create = (key: string) => runtime.app.handle({ method: "POST", path: "/api/v1/ai_novel/billing/alipay/orders", headers,
    body: { productKey: "plus_monthly", platform: "web", distribution: "web", checkoutMode: "desktop_web", idempotencyKey: key } });
  const catalog = () => runtime.app.handle({ method: "GET", path: "/api/v1/ai_novel/billing/catalog", headers: { "x-app-region": "CN" },
    query: { platform: "web", distribution: "web" } });
  const save = async (prices?: AlipayPrices) => {
    const config = JSON.parse((await admin.getConfig("ai_novel")).rawJson);
    config.billing ??= {};
    if (prices) config.billing.alipay = { prices };
    else delete config.billing.alipay;
    return admin.updateConfig("ai_novel", JSON.stringify(config));
  };
  return { ...runtime, admin, create, catalog, save, evidence };
}

test("admin price updates and restores immediately reach catalog and new orders, while replays retain the original price", async t => {
  const f = await fixture(t);
  const first = await f.save(TEST_ALIPAY_PRICES);
  const old = await f.create("pricing_original");
  assert.equal(old.statusCode, 200);
  assert.equal(old.body.data.order.amountMinor, 3800);
  const next = { ...TEST_ALIPAY_PRICES, plus_monthly: 4200 };
  await f.save(next);
  assert.equal((await f.catalog()).body.data.products[0].providers[0].price.amountMinor, 4200);
  assert.equal((await f.create("pricing_updated")).body.data.order.amountMinor, 4200);
  assert.equal((await f.create("pricing_original")).body.data.order.amountMinor, 3800);
  const publicConfig = await f.app.handle({ method: "GET", path: "/api/v1/ai_novel/public/config", headers: {} });
  assert.equal(publicConfig.statusCode, 200);
  assert.deepEqual(publicConfig.body.data.config.billing.alipay.prices, next);
  await f.admin.restoreConfig("ai_novel", first.revision!);
  assert.equal((await f.catalog()).body.data.products[0].providers[0].price.amountMinor, 3800);
  assert.equal((await f.create("pricing_restored")).body.data.order.amountMinor, 3800);
  assert.equal((await f.create("pricing_updated")).body.data.order.amountMinor, 4200);
});

test("price reads follow the latest revision even when the database projection is stale", async t => {
  const f = await fixture(t);
  const old = (await f.database.findAppConfig("ai_novel", "admin.delivery_config"))!;
  const previous = { ...old };
  await f.save({ ...TEST_ALIPAY_PRICES, plus_monthly: 4600 });
  await f.database.upsertAppConfig(previous);
  assert.equal((await f.catalog()).body.data.products[0].providers[0].price.amountMinor, 4600);
  await f.database.upsertAppConfig(previous);
  assert.equal((await f.create("pricing_latest_revision")).body.data.order.amountMinor, 4600);
});

test("missing prices stop new sales without falling back to code or environment defaults", async t => {
  const f = await fixture(t, false);
  const offer = (await f.catalog()).body.data.products[0].providers[0];
  assert.equal(offer.available, false);
  assert.equal(offer.price, null);
  assert.equal((await f.create("pricing_unconfigured")).statusCode, 503);
});

for (const confirmation of ["notify", "sync", "recovery"] as const) {
  test(`removing prices stops new sales but preserves old-order replay and ${confirmation}`, async t => {
    const f = await fixture(t);
    const created = await f.create(`pricing_remove_${confirmation}`);
    const id = created.body.data.order.orderId;
    await f.save();
    assert.equal((await f.catalog()).body.data.products[0].providers[0].available, false);
    assert.equal((await f.create(`pricing_missing_${confirmation}`)).statusCode, 503);
    const replay = await f.create(`pricing_remove_${confirmation}`);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body.data.order.amountMinor, 3800);
    if (confirmation === "notify") {
      const response = await f.app.handle({ method: "POST", path: "/api/v1/ai_novel/billing/webhooks/alipay",
        headers: { "content-type": "application/x-www-form-urlencoded" }, body: Buffer.from(new URLSearchParams(f.evidence(id)).toString()) });
      assert.equal(response.statusCode, 200);
      assert.equal(response.rawBody, "success");
    } else if (confirmation === "sync") {
      const result = await f.services.aiNovelBillingService.syncMembership({ userId: "user_alice", provider: "alipay", requestId: "pricing",
        purchaseReference: { kind: "alipay_order", id } });
      assert.equal(result.syncStatus, "complete");
    } else await f.services.aiNovelBillingService.alipay.recoverOrders();
    assert.equal((await f.database.findAiNovelAlipayOrder(id))?.membershipApplied, true);
  });
}

test("invalid saves and historical restores cannot replace the current valid price revision", async t => {
  const f = await fixture(t);
  const valid = await f.save(TEST_ALIPAY_PRICES);
  const invalid = [null, {}, { ...TEST_ALIPAY_PRICES, plus_monthly: -1 },
    { ...TEST_ALIPAY_PRICES, plus_monthly: 1_000_000_000_000 }, { ...TEST_ALIPAY_PRICES, extra: 1 }];
  for (const prices of invalid) {
    await assert.rejects(f.admin.updateConfig("ai_novel", JSON.stringify({ billing: { alipay: { prices } } })), { code: "ADMIN_CONFIG_INVALID_JSON" });
    assert.equal((await f.admin.getConfig("ai_novel")).revision, valid.revision);
  }
  const bad = await f.services.appConfigService.setValue("ai_novel", "admin.delivery_config", JSON.stringify({ billing: { alipay: { prices: {} } } }));
  const repaired = await f.save(TEST_ALIPAY_PRICES);
  await assert.rejects(f.admin.restoreConfig("ai_novel", bad.revision), { code: "ADMIN_CONFIG_INVALID_JSON" });
  assert.equal((await f.admin.getConfig("ai_novel")).revision, repaired.revision);
  assert.equal((await f.catalog()).body.data.products[0].providers[0].price.amountMinor, 3800);
});
