import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { readRequestBody } from "../../src/infrastructure/http/request-body.ts";
import { encodeHttpResponseBody } from "../../src/infrastructure/http/response-body.ts";
import { AiNovelBillingAdminService } from "../../src/services/ainovel-billing-admin.service.ts";
import type { AlipayGateway } from "../../src/modules/billing/alipay-models.ts";
import { fixtureFetcher, snapshot } from "../support/revenuecat-v2-fixtures.ts";
import { AiNovelBillingService } from "../../src/services/ainovel-billing.service.ts";

const ORDERS = "/api/v1/ai_novel/billing/alipay/orders";
const NOTIFY = "/api/v1/ai_novel/billing/webhooks/alipay";
const NOW = new Date("2026-10-04T10:00:00Z");
async function fixture(overrides: Record<string, unknown> = {}) {
  const seed = buildDefaultSeed();
  seed.appUsers!.push({ id: "alipay_alice", appId: "ai_novel", userId: "user_alice", status: "ACTIVE", accountRegion: "CN", joinedAt: NOW.toISOString() });
  seed.appUsers!.push({ id: "alipay_bob", appId: "ai_novel", userId: "user_bob", status: "ACTIVE", accountRegion: "CN", joinedAt: NOW.toISOString() });
  let response: Record<string, unknown> = { code: "40004" };
  const gateway: AlipayGateway = { payment: async order => order.platform === "android" ? { type: "app", orderString: "secret_checkout_payload" } : { type: "page", url: "https://openapi-sandbox.dl.alipaydev.com/gateway.do?secret" },
    query: async () => response, verifyNotify: async fields => fields.sign === "test_valid" };
  const runtime = await createApplication({ seed, alipay: { enabled: true, appId: "merchant", sellerId: "seller", environment: "sandbox",
    notifyUrl: "https://example.test/notify", returnUrl: "https://example.test/return", gateway, now: () => NOW, ...overrides }, revenueCat: { now: () => NOW } });
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "ai_novel");
  const headers = { "x-app-id": "ai_novel", authorization: `Bearer ${token}` };
  const create = (body = { productKey: "plus_monthly", platform: "android", distribution: "direct_android", idempotencyKey: "test_key_0001" }) => runtime.app.handle({ method: "POST", path: ORDERS, headers, body });
  const query = (id: string) => runtime.app.handle({ method: "GET", path: `${ORDERS}/${id}`, headers });
  const fields = (id: string, extra: Record<string, string> = {}) => ({ out_trade_no: id, app_id: "merchant", seller_id: "seller", trade_no: "202610040000000001", total_amount: "38.00", trade_status: "TRADE_SUCCESS", gmt_payment: "2026-10-04 18:00:00", sign_type: "RSA2", sign: "test_valid", ...extra });
  const notify = (id: string, extra?: Record<string, string>) => runtime.app.handle({ method: "POST", path: NOTIFY, headers: { "content-type": "application/x-www-form-urlencoded" }, body: Buffer.from(new URLSearchParams(fields(id, extra)).toString()) });
  return { ...runtime, create, query, notify, fields, setResponse: (value: Record<string, unknown>) => { response = value; }, headers };
}

test("Alipay authenticated routes persist pending and replay owned idempotency without duplicate orders", async () => {
  const f = await fixture(); const first = await f.create(); const id = first.body.data.order.orderId;
  assert.equal(first.statusCode, 200); assert.equal(first.body.data.order.environment, "sandbox");
  assert.match(id, /^ow_and_a01_user_a_[a-f0-9]{16}$/);
  assert.equal(first.body.data.payment.type, "app");
  assert.equal((await f.create()).body.data.order.orderId, id);
  assert.equal((await f.create({ productKey: "pro_monthly", platform: "android", distribution: "direct_android", idempotencyKey: "test_key_0001" })).statusCode, 409);
  const admin = new AiNovelBillingAdminService(f.database);
  const list = await admin.listOrders({ provider: "alipay", status: "pending", distribution: "direct_android", checkoutId: id });
  assert.equal(list.items.length, 1); assert.equal(list.items[0].paymentStatus, "pending");
  assert.equal((await admin.listOrders({ status: "provider_paid" })).items.length, 0);
});

test("legacy alp orders remain queryable and settle without rewriting their IDs", async () => {
  const f = await fixture(); const id = (await f.create()).body.data.order.orderId;
  const original = (await f.database.findAiNovelAlipayOrder(id))!;
  const legacyId = `alp_${"d".repeat(32)}`;
  await f.database.saveAiNovelAlipayOrder({ ...original, orderId: legacyId, idempotencyKey: "legacy_order_intent" });
  assert.equal((await f.query(legacyId)).body.data.order.orderId, legacyId);
  assert.equal((await f.notify(legacyId)).rawBody, "success");
  assert.equal((await f.query(legacyId)).body.data.order.membershipApplied, true);
  assert.equal((await f.query(`xx_${"d".repeat(32)}`)).statusCode, 404);
});

test("Alipay signed query and duplicate notify converge once; query needs no app_id response", async () => {
  const f = await fixture(); const id = (await f.create()).body.data.order.orderId;
  const fields = f.fields(id); const { app_id, seller_id, sign, sign_type, ...query } = fields;
  f.setResponse({ ...query, code: "10000", send_pay_date: fields.gmt_payment });
  assert.equal((await f.query(id)).body.data.order.membershipApplied, true);
  const before = await f.database.findAiNovelBillingMembership("ai_novel", "user_alice");
  assert.equal(before!.creditWindowAnchorAt, "2026-10-04T10:00:00.000Z");
  assert.equal((await f.notify(id)).rawBody, "success"); assert.equal((await f.notify(id)).rawBody, "success");
  assert.equal((await f.database.findAiNovelBillingMembership("ai_novel", "user_alice"))!.expiresAt, before!.expiresAt);
  assert.equal((await f.database.findAiNovelBillingMembership("ai_novel", "user_alice"))!.creditWindowAnchorAt, before!.creditWindowAnchorAt);
  assert.equal((await f.database.listAiNovelBillingTransactions("ai_novel", "user_alice")).length, 1);
  assert.equal((await f.create()).body.data.payment, null);
});

test("Alipay rejects signatures, app/seller/amount/order drift and duplicate form fields", async () => {
  const f = await fixture(); const id = (await f.create()).body.data.order.orderId;
  for (const extra of [{ sign: "invalid" }, { app_id: "other" }, { seller_id: "other" }, { total_amount: "0.01" }, { trade_status: "UNKNOWN" }]) {
    assert.notEqual((await f.notify(id, extra)).statusCode, 200);
  }
  const duplicate = await f.app.handle({ method: "POST", path: NOTIFY, headers: { "content-type": "application/x-www-form-urlencoded" }, body: Buffer.from(new URLSearchParams(f.fields(id)).toString() + "&total_amount=38.00") });
  assert.equal(duplicate.statusCode, 400);
  assert.equal((await f.query(id)).body.data.order.membershipApplied, false);
  assert.equal((await f.notify(id)).statusCode, 200);
  assert.equal((await f.notify(id, { trade_no: "202610040000000002" })).statusCode, 400);
});

test("Alipay query rejects unverified/unavailable and mismatched order evidence without grants", async () => {
  const f = await fixture(); const id = (await f.create()).body.data.order.orderId;
  f.setResponse({ ...f.fields("alp_" + "0".repeat(32)), code: "10000" });
  const result = await f.query(id); assert.equal(result.body.data.syncStatus, "pending"); assert.equal(result.body.data.order.membershipApplied, false);
  const otherToken = f.services.tokenService.issueAccessToken("user_bob", "ai_novel");
  assert.equal((await f.app.handle({ method: "GET", path: `${ORDERS}/${id}`, headers: { ...f.headers, authorization: `Bearer ${otherToken}` } })).statusCode, 404);
});

test("Alipay highest-tier access grants lower tier independently; late CLOSED cannot undo payment", async () => {
  const f = await fixture(); const plus = (await f.create()).body.data.order.orderId; await f.notify(plus);
  const pro = (await f.create({ productKey: "pro_monthly", platform: "web", distribution: "web", idempotencyKey: "test_key_0002" })).body.data.order.orderId;
  await f.notify(pro, { total_amount: "88.00", trade_no: "202610040000000002" });
  assert.equal((await f.query(plus)).body.data.membership.tier, "pro");
  assert.equal((await f.query(plus)).body.data.order.membershipApplied, true);
  await f.notify(plus, { trade_status: "TRADE_CLOSED" });
  assert.equal((await f.query(plus)).body.data.order.status, "paid");
});

test("Alipay soft deletion retains late financial payment but never grants deleted account", async () => {
  const f = await fixture(); const id = (await f.create()).body.data.order.orderId;
  await f.database.softDeleteAiNovelBillingAccount("ai_novel", "user_alice", NOW.toISOString());
  await f.notify(id);
  const order = await f.database.findAiNovelAlipayOrder(id); assert.equal(order!.status, "paid"); assert.equal(order!.membershipApplied, false);
  const tx = (await f.database.listAiNovelBillingTransactions("ai_novel", "user_alice"))[0]; assert.equal(tx.amountMinor, 3800); assert.ok(tx.accountDeletedAt);
});

test("optional seller configuration allows default-merchant checkout and settlement", async () => {
  for (const sellerId of [undefined, "", "   "]) {
    const f = await fixture({ sellerId });
    const created = await f.create(); assert.equal(created.statusCode, 200);
    const id = created.body.data.order.orderId;
    assert.equal((await f.create()).body.data.order.orderId, id);
    assert.notEqual((await f.notify(id, { app_id: "other" })).statusCode, 200);
    assert.notEqual((await f.notify(id, { total_amount: "0.01" })).statusCode, 200);
    assert.notEqual((await f.notify(id, { seller_id: "" })).statusCode, 200);
    f.setResponse({ ...f.fields(id), code: "10000" });
    assert.equal((await f.query(id)).body.data.order.membershipApplied, true);
    assert.equal((await f.notify(id)).rawBody, "success");
    assert.equal((await f.database.listAiNovelBillingTransactions("ai_novel", "user_alice")).length, 1);
  }
  const f = await fixture({ sellerId: undefined });
  const id = (await f.create()).body.data.order.orderId;
  assert.equal((await f.notify(id)).rawBody, "success");
  assert.equal((await f.query(id)).body.data.order.membershipApplied, true);
});

test("Alipay production remains gated and wrong region/channel are rejected", async () => {
  const disabled = await fixture({ enabled: false }); assert.equal((await disabled.create()).statusCode, 503);
  const unapproved = await fixture({ environment: "production" }); assert.equal((await unapproved.create()).statusCode, 503);
  const f = await fixture(); assert.equal((await f.create({ productKey: "plus_monthly", platform: "web", distribution: "direct_android", idempotencyKey: "test_key_0001" })).statusCode, 403);
});

test("client cancellation permits a new idempotency intent while preserving old pending order", async () => {
  const f = await fixture(); const first = (await f.create()).body.data.order.orderId;
  const next = await f.create({ productKey: "plus_monthly", platform: "android", distribution: "direct_android", idempotencyKey: "new_intent_after_cancel" });
  assert.equal(next.statusCode, 200); assert.notEqual(next.body.data.order.orderId, first);
  assert.equal((await f.database.findAiNovelAlipayOrder(first))!.status, "pending");
});

test("admin Alipay effective filters, real trade search and immutable createdAt agree", async () => {
  const f = await fixture(); const id = (await f.create()).body.data.order.orderId;
  await f.notify(id);
  const row = (await f.database.listAiNovelBillingTransactions("ai_novel", "user_alice"))[0];
  await f.database.upsertAiNovelBillingTransaction({ ...row, observedAt: "2026-10-05T10:00:00Z", purchasedAt: "2026-10-05T09:00:00Z", createdAt: "2026-10-05T09:00:00Z", expiresAt: "2099-01-01T00:00:00Z" });
  const admin = new AiNovelBillingAdminService(f.database);
  const active = await admin.listOrders({ provider: "alipay", status: "entitlement_active", providerTransactionId: "202610040000000001", createdTo: "2026-10-04T12:00:00Z" });
  assert.equal(active.items.length, 1); assert.equal(active.items[0].createdAt, NOW.toISOString()); assert.equal(active.items[0].providerOrderId, "202610040000000001");
  await f.database.upsertAiNovelBillingTransaction({ ...row, observedAt: "2026-10-06T10:00:00Z", expiresAt: "2026-01-01T00:00:00Z" });
  assert.equal((await admin.listOrders({ provider: "alipay", status: "expired" })).items.length, 1);
  assert.equal((await admin.listOrders({ provider: "alipay", status: "entitlement_active" })).items.length, 0);
});

test("failed checkout preparation is visible and terminal without leaking SDK errors", async () => {
  const gateway: AlipayGateway = { payment: async () => { throw new Error("SECRET_PROVIDER_PAYLOAD"); }, query: async () => { throw new Error("must_not_query"); }, verifyNotify: async () => false };
  const f = await fixture({ gateway }); assert.equal((await f.create()).statusCode, 503);
  const row = (await new AiNovelBillingAdminService(f.database).listOrders({ status: "failed" })).items[0];
  const query = await f.query(row.checkoutId!); assert.equal(query.body.data.order.status, "failed"); assert.equal(query.body.data.syncStatus, "synchronized");
  assert.ok(!JSON.stringify(f.logger.records).includes("SECRET_PROVIDER_PAYLOAD"));
});

test("expired checkout replay has no payment; only a verified expired trade-not-exist query closes it", async () => {
  let time = new Date(NOW);
  const f = await fixture({ now: () => time }); const id = (await f.create()).body.data.order.orderId;
  time = new Date(NOW.getTime() + 31 * 60000);
  const replay = await f.create(); assert.equal(replay.body.data.order.orderId, id); assert.equal(replay.body.data.payment, null);
  assert.equal((await f.query(id)).body.data.order.status, "pending");
  f.setResponse({ code: "40004", sub_code: "ACQ.TRADE_NOT_EXIST" });
  assert.equal((await f.query(id)).body.data.order.status, "closed");
});

test("RC synchronization cannot erase expired Alipay or its active Plus fallback after Pro expiry", async () => {
  const f = await fixture(); const plus = (await f.create({ productKey: "plus_yearly", platform: "android", distribution: "direct_android", idempotencyKey: "plus_year_key" })).body.data.order.orderId;
  await f.notify(plus, { total_amount: "298.00" });
  const pro = (await f.create({ productKey: "pro_monthly", platform: "web", distribution: "web", idempotencyKey: "pro_month_key" })).body.data.order.orderId;
  await f.notify(pro, { total_amount: "88.00", trade_no: "202610040000000002" });
  let time = new Date("2026-11-05T10:00:00Z");
  const service = new AiNovelBillingService(f.database, { secretApiKey: "test", revenueCatProjectId: "proj_test", revenueCatAppId: "rc_test", now: () => time,
    fetcher: fixtureFetcher(async () => Response.json(snapshot({ entitlements: {}, subscriptions: {} })), "rc_test") }, f.logger);
  const sync = () => service.sync({ userId: "user_alice", requestId: "fallback_test", reason: "retry" });
  assert.equal((await sync()).membership.planKey, "plus_yearly"); assert.equal((await service.getMembership("user_alice")).active, true);
  time = new Date("2027-11-05T10:00:00Z");
  const expired = (await sync()).membership; assert.equal(expired.active, false); assert.equal(expired.source, "alipay"); assert.equal(expired.state, "expired");
});

test("concurrent query and notify settle once; late provider overlap is paid but unapplied", async () => {
  const f = await fixture(); const id = (await f.create()).body.data.order.orderId;
  f.setResponse({ ...f.fields(id), code: "10000" });
  await Promise.all([f.query(id), f.notify(id), f.notify(id)]);
  assert.equal((await f.database.findAiNovelAlipayOrder(id))!.membershipExpiresAt, "2026-11-04T10:00:00.000Z");
  const second = (await f.create({ productKey: "plus_monthly", platform: "android", distribution: "direct_android", idempotencyKey: "another_paid_intent" })).body.data.order.orderId;
  await f.database.upsertAiNovelBillingMembership({ appId: "ai_novel", userId: "user_alice", active: true, state: "active", tier: "pro", planKey: "pro_yearly",
    expiresAt: "2099-01-01T00:00:00Z", source: "app_store", autoRenew: true, managementUrl: null, accountDeletedAt: null, lastSyncedAt: NOW.toISOString() });
  await f.notify(second, { trade_no: "202610040000000002" });
  const result = (await f.query(second)).body.data; assert.equal(result.order.status, "paid"); assert.equal(result.order.membershipApplied, false); assert.equal(result.order.conflict, "provider_conflict"); assert.equal(result.syncStatus, "pending");
  assert.equal((await f.create({ productKey: "plus_monthly", platform: "android", distribution: "direct_android", idempotencyKey: "blocked_new_intent" })).statusCode, 409);
});

test("actual HTTP form Buffer acknowledgement is exactly success, bounded, and logs redact checkout", async () => {
  const f = await fixture(); const id = (await f.create()).body.data.order.orderId;
  const server = createServer(async (req, res) => {
    try {
      const result = await f.app.handle({ method: req.method!, path: req.url!, headers: { "content-type": req.headers["content-type"] }, body: await readRequestBody(req, req.headers["content-type"], 16384) });
      res.statusCode = result.statusCode; res.setHeader("Content-Type", result.contentType ?? "application/json");
      res.end(result.rawBody ?? encodeHttpResponseBody(result.body, result.contentType));
    } catch { res.statusCode = 400; res.end("rejected"); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}${NOTIFY}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(f.fields(id)).toString() });
    assert.equal(response.status, 200); assert.equal(await response.text(), "success");
    const oversized = await fetch(`http://127.0.0.1:${address.port}${NOTIFY}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "a=" + "x".repeat(16384) }); assert.equal(oversized.status, 400);
    const logs = JSON.stringify(f.logger.records); assert.ok(logs.includes("notify_settled")); assert.ok(!logs.includes("secret_checkout_payload")); assert.ok(!logs.includes("test_valid"));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
