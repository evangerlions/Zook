import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { seedAlipayPrices, TEST_ALIPAY_PRICES } from "../support/alipay-pricing-fixture.ts";
import type { HttpRequest, HttpResponse } from "../../src/shared/types.ts";
import type { AlipayOrder, AlipayEnvironmentOptions } from "../../src/modules/billing/alipay-models.ts";
import { billingEnvironment, billingRequestEnvironment, billingSandboxAllowed, inBillingEnvironment, type BillingEnvironment } from "../../src/modules/billing/billing-environment.ts";

const ENVIRONMENTS = ["production", "sandbox"] as const;
const NOW = new Date("2026-11-03T10:00:00Z");
const ORDERS = "/api/v1/ai_novel/billing/alipay/orders";
const NOTIFY = "/api/v1/ai_novel/billing/webhooks/alipay";

async function fixture(t: TestContext, appEnvironment = "dev") {
  const seed = buildDefaultSeed(); seedAlipayPrices(seed);
  seed.appUsers!.push({ id: "dual_alice", appId: "ai_novel", userId: "user_alice", status: "ACTIVE", accountRegion: "CN", joinedAt: NOW.toISOString() });
  const orders = new Map<string, AlipayOrder>();
  const queried: Record<BillingEnvironment, string[]> = { production: [], sandbox: [] };
  const verified: Record<BillingEnvironment, number> = { production: 0, sandbox: 0 };
  const options: AlipayEnvironmentOptions = {};
  const evidence = (id: string, environment: BillingEnvironment) => ({ code: "10000", out_trade_no: id,
    app_id: `merchant_${environment}`, seller_id: "seller", trade_no: BigInt(`0x${id.slice(-16)}`).toString().padStart(20, "0"),
    total_amount: (orders.get(id)!.amountMinor / 100).toFixed(2), trade_status: "TRADE_SUCCESS",
    gmt_payment: "2026-11-03 18:00:00", sign_type: "RSA2", sign: `signed_${environment}` });
  for (const environment of ENVIRONMENTS) options[environment] = {
    appId: `merchant_${environment}`, now: () => NOW,
    // Local production deliberately has no public callback target.
    gateway: {
      payment: async order => {
        assert.equal(order.environment, environment);
        assert.equal(billingEnvironment(), environment);
        orders.set(order.orderId, order);
        return { type: "page", url: `https://cashier.example.test/${environment}` };
      },
      query: async id => {
        assert.equal(orders.get(id)!.environment, environment);
        assert.equal(billingEnvironment(), environment);
        queried[environment].push(id); return evidence(id, environment);
      },
      verifyNotify: async fields => { verified[environment]++; return fields.sign === `signed_${environment}`; },
    },
  };
  const runtime = await createApplication({ seed, appEnvironment, alipay: options, revenueCat: { now: () => NOW } });
  t.after(() => runtime.close());
  const handle = runtime.app.handle.bind(runtime.app) as (request: HttpRequest) => Promise<HttpResponse<any>>;
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "ai_novel");
  const headers = (environment: BillingEnvironment) => ({ "x-app-id": "ai_novel", "x-app-region": "CN",
    "x-billing-environment": environment, authorization: `Bearer ${token}` });
  const create = (environment: BillingEnvironment, key = "shared_retry_identity") => handle({ method: "POST", path: ORDERS,
    headers: headers(environment), body: { productKey: "plus_monthly", platform: "windows", distribution: "windows", checkoutMode: "desktop_web", idempotencyKey: key } });
  const catalog = (environment: BillingEnvironment) => handle({ method: "GET", path: "/api/v1/ai_novel/billing/catalog",
    headers: headers(environment), query: { platform: "windows", distribution: "windows" } });
  const notify = (id: string, environment: BillingEnvironment, extra: Record<string, string> = {}) => handle({ method: "POST", path: NOTIFY,
    headers: { "content-type": "application/x-www-form-urlencoded", "x-billing-environment": "production" },
    body: Buffer.from(new URLSearchParams({ ...evidence(id, environment), ...extra }).toString()) });
  return { ...runtime, create, catalog, notify, headers, evidence, orders, queried, verified };
}

for (const deployment of ["local", "dev", "development", "test", "online", "production", "unknown", ""]) {
  test(`deployment ${deployment || "missing"} is the only sandbox admission policy`, () => {
    const allow = ["local", "dev", "development", "test"].includes(deployment);
    assert.equal(billingSandboxAllowed(deployment), allow);
    assert.equal(billingRequestEnvironment({ headers: {} } as any, deployment), "production");
    const request = { headers: { "x-billing-environment": "sandbox" } } as any;
    if (allow) assert.equal(billingRequestEnvironment(request, deployment), "sandbox");
    else assert.throws(() => billingRequestEnvironment(request, deployment), { code: "BILLING_ENVIRONMENT_FORBIDDEN" });
  });
}

for (const deployment of ["local", "dev"]) {
  test(`${deployment} concurrently serves both cashiers and independent idempotent orders with one price catalog`, async t => {
    const f = await fixture(t, deployment);
    const results = await Promise.all(ENVIRONMENTS.map(environment => f.create(environment)));
    for (const [index, environment] of ENVIRONMENTS.entries()) {
      assert.equal(results[index].statusCode, 200);
      const { order, payment } = results[index].body.data;
      assert.equal(order.environment, environment);
      assert.equal(order.amountMinor, 3800);
      assert.equal(payment.url, `https://cashier.example.test/${environment}`);
      assert.equal((await f.create(environment)).body.data.order.orderId, order.orderId);
      const other = environment === "production" ? "sandbox" : "production";
      const hidden = await f.app.handle({ method: "GET", path: `${ORDERS}/${order.orderId}`, headers: f.headers(other) });
      assert.equal(hidden.statusCode, 404);
      const offer = (await f.catalog(environment)).body.data.products[0].providers[0];
      assert.equal(offer.available, true); assert.equal(offer.price.amountMinor, 3800);
    }
    assert.notEqual(results[0].body.data.order.orderId, results[1].body.data.order.orderId);
    assert.equal(billingEnvironment(), "production");
  });
}

test("callbacks use the persisted order's verifier, ignore header scope and cannot cross-grant", async t => {
  const f = await fixture(t);
  const production = (await f.create("production")).body.data.order.orderId;
  const sandbox = (await f.create("sandbox")).body.data.order.orderId;
  assert.equal((await f.notify(sandbox, "sandbox", { sign: "signed_production" })).statusCode, 401);
  assert.equal((await f.notify(sandbox, "sandbox", { app_id: "merchant_production" })).statusCode, 400);
  assert.equal((await f.notify(sandbox, "sandbox")).rawBody, "success");
  assert.equal((await f.services.aiNovelBillingService.getMembership("user_alice")).active, false);
  assert.equal((await inBillingEnvironment("sandbox", () => f.services.aiNovelBillingService.getMembership("user_alice"))).active, true);
  assert.equal((await f.notify(production, "production")).rawBody, "success");
  for (const environment of ENVIRONMENTS) {
    const membership = await inBillingEnvironment(environment, () => f.services.aiNovelBillingService.getMembership("user_alice"));
    assert.equal(membership.expiresAt, "2026-12-03T10:00:00.000Z");
  }
  const transactions = await f.database.listAiNovelBillingTransactions("ai_novel", "user_alice");
  assert.equal(transactions.length, 2);
  assert.deepEqual(transactions.map(tx => tx.isSandbox).sort(), [false, true]);
  assert.ok(f.verified.sandbox >= 3); assert.equal(f.verified.production, 1);
});

test("an explicitly capitalized payment environment header wins over fixture async context", async t => {
  const f = await fixture(t);
  const headers = f.headers("production"); delete (headers as Record<string, string>)["x-billing-environment"];
  const response = await f.app.handle({ method: "POST", path: ORDERS, headers: { ...headers, "X-Billing-Environment": "sandbox" },
    body: { productKey: "plus_monthly", platform: "windows", distribution: "windows", checkoutMode: "desktop_web", idempotencyKey: "capitalized_header_identity" } });
  assert.equal(response.statusCode, 200);
  assert.equal((response.body as { data: { order: AlipayOrder } }).data.order.environment, "sandbox");
});

test("one Admin price edit/removal affects both environments while frozen orders recover independently", async t => {
  const f = await fixture(t);
  const old = await Promise.all(ENVIRONMENTS.map(environment => f.create(environment)));
  const admin = f.services.adminConsoleService;
  const config = JSON.parse((await admin.getConfig("ai_novel")).rawJson);
  config.billing.alipay.prices = { ...TEST_ALIPAY_PRICES, plus_monthly: 4200 };
  await admin.updateConfig("ai_novel", JSON.stringify(config));
  for (const [index, environment] of ENVIRONMENTS.entries()) {
    assert.equal((await f.catalog(environment)).body.data.products[0].providers[0].price.amountMinor, 4200);
    assert.equal((await f.create(environment, "changed_price_identity")).body.data.order.amountMinor, 4200);
    assert.equal((await f.create(environment)).body.data.order.amountMinor, 3800);
    assert.equal((await f.create(environment)).body.data.order.orderId, old[index].body.data.order.orderId);
  }
  delete config.billing.alipay;
  await admin.updateConfig("ai_novel", JSON.stringify(config));
  for (const environment of ENVIRONMENTS) {
    assert.equal((await f.catalog(environment)).body.data.products[0].providers[0].available, false);
    assert.equal((await f.create(environment, "missing_price_identity")).statusCode, 503);
  }
  await f.services.aiNovelBillingService.alipay.recoverOrders();
  for (const environment of ENVIRONMENTS) {
    assert.equal(f.queried[environment].length, 2);
    for (const id of f.queried[environment]) assert.equal((await f.database.findAiNovelAlipayOrder(id))?.membershipApplied, true);
  }
});

test("online discards injected sandbox credentials and never starts sandbox checkout or recovery", async t => {
  const f = await fixture(t, "online");
  assert.equal((await f.catalog("sandbox")).statusCode, 403);
  assert.equal((await f.create("sandbox")).statusCode, 403);
  const production = (await f.create("production")).body.data.order.orderId;
  await f.services.aiNovelBillingService.alipay.recoverOrders();
  assert.deepEqual(f.queried.production, [production]); assert.deepEqual(f.queried.sandbox, []);
  const original = f.orders.get(production)!;
  const sandbox: AlipayOrder = { ...original, orderId: `alp_${"c".repeat(32)}`, environment: "sandbox", merchantAppId: "merchant_sandbox" };
  f.orders.set(sandbox.orderId, sandbox); await f.database.saveAiNovelAlipayOrder(sandbox);
  assert.equal((await f.notify(sandbox.orderId, "sandbox")).statusCode, 403);
  assert.equal(f.verified.sandbox, 0);
  await assert.rejects(() => inBillingEnvironment("sandbox", () => f.services.aiNovelBillingService.alipay.create("user_alice", "CN", original)),
    { code: "BILLING_ENVIRONMENT_FORBIDDEN" });
});

test("a failed environment scan is logged and cannot prevent the other environment's recovery", async t => {
  const f = await fixture(t);
  const sandbox = (await f.create("sandbox")).body.data.order.orderId;
  const list = f.database.listAiNovelAlipayRecovery.bind(f.database);
  f.database.listAiNovelAlipayRecovery = (...args) => {
    if (billingEnvironment() === "production") throw new Error("fixture scan failure");
    return list(...args);
  };
  await assert.rejects(() => f.services.aiNovelBillingService.alipay.recoverOrders(), AggregateError);
  assert.deepEqual(f.queried.sandbox, [sandbox]);
  assert.equal((await f.database.findAiNovelAlipayOrder(sandbox))?.membershipApplied, true);
  assert.ok(f.logger.records.some(record => record.message === "alipay environment recovery failed" && record.environment === "production"));
});
