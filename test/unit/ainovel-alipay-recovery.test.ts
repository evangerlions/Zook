import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { startAlipayRecovery } from "../../src/services/ainovel-alipay-recovery.ts";
import type { AlipayGateway } from "../../src/modules/billing/alipay-models.ts";

const NOW = new Date("2026-10-18T10:00:00Z");
async function fixture() {
  const seed = buildDefaultSeed();
  seed.appUsers!.push({ id: "recovery_alice", appId: "ai_novel", userId: "user_alice", status: "ACTIVE", accountRegion: "CN", joinedAt: NOW.toISOString() });
  const queried: string[] = [];
  let paid = true;
  let clock = NOW.getTime();
  const evidence = (id: string) => ({ code: "10000", out_trade_no: id, app_id: "merchant", seller_id: "seller",
    trade_no: `202610180000${id.slice(-6).replace(/[a-f]/g, '1')}`, total_amount: "38.00", trade_status: paid ? "TRADE_SUCCESS" : "WAIT_BUYER_PAY",
    gmt_payment: "2026-10-18 18:00:00", sign_type: "RSA2", sign: "valid" });
  const gateway: AlipayGateway = { payment: async () => ({ type: "qr", qrCode: "test" }),
    query: async id => { queried.push(id); return evidence(id); }, verifyNotify: async () => true };
  const runtime = await createApplication({ seed, alipay: { enabled: true, appId: "merchant", sellerId: "seller",
    environment: "sandbox", notifyUrl: "https://example.test/notify", returnUrl: "https://example.test/return", gateway, now: () => new Date(clock++) }, revenueCat: { now: () => NOW } });
  const service = runtime.services.aiNovelBillingService.alipay;
  const create = async (key: string) => (await service.create("user_alice", "CN", {
    productKey: "plus_monthly", platform: "web", distribution: "web", idempotencyKey: key,
  })).order.orderId;
  return { ...runtime, service, create, queried, evidence, unpaid: () => { paid = false; } };
}

test("startup timer coalesces overlapping ticks and continues after failure", async () => {
  const f = await fixture();
  let calls = 0;
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const task = startAlipayRecovery(async () => { calls++; await blocked; if (calls === 1) throw new Error("temporary"); }, f.logger);
  await Promise.resolve();
  await task.run(); await task.run();
  assert.equal(calls, 1);
  release(); await new Promise(resolve => setImmediate(resolve));
  await task.run(); assert.equal(calls, 2);
  await task.stop(); await task.run(); assert.equal(calls, 2);
  await f.close();
});

test("stop prevents new ticks immediately while the current pass drains", async () => {
  const f = await fixture();
  let calls = 0;
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const task = startAlipayRecovery(async () => { calls++; await blocked; }, f.logger, 5);
  await Promise.resolve();
  const stopping = task.stop();
  await new Promise(resolve => setTimeout(resolve, 20));
  await task.run();
  assert.equal(calls, 1);
  release(); await stopping;
  await f.close();
});

test("bounded sequential recovery settles missed notifications, then notify/query do not double grant", async () => {
  const f = await fixture();
  try {
    const first = await f.create("recovery_first");
    const second = await f.create("recovery_second");
    await f.service.recoverOrders(1);
    assert.equal(f.queried.length, 1);
    const settledId = f.queried[0];
    const before = (await f.database.findAiNovelAlipayOrder(settledId))!.membershipExpiresAt;
    await f.service.notify(Buffer.from(new URLSearchParams(f.evidence(settledId)).toString()));
    await f.service.query("user_alice", settledId);
    assert.equal((await f.database.findAiNovelAlipayOrder(settledId))!.membershipExpiresAt, before);
    await f.service.recoverOrders(1);
    assert.equal((await f.database.findAiNovelAlipayOrder(first))!.membershipApplied, true);
    assert.equal((await f.database.findAiNovelAlipayOrder(second))!.membershipApplied, true);
    assert.equal(f.queried.length, 2);
  } finally { await f.close(); }
});

test("paid unapplied is retried through canonical grant path after a transient conflict clears", async () => {
  const f = await fixture();
  try {
    const id = await f.create("recovery_unapplied");
    await f.database.upsertAiNovelBillingMembership({ appId: "ai_novel", userId: "user_alice", source: "app_store",
      active: true, state: "active", tier: "plus", planKey: "plus_monthly", expiresAt: "2027-01-01T00:00:00Z", autoRenew: false,
      managementUrl: null, accountDeletedAt: null, lastSyncedAt: NOW.toISOString() });
    await f.service.notify(Buffer.from(new URLSearchParams(f.evidence(id)).toString()));
    assert.equal((await f.database.findAiNovelAlipayOrder(id))!.membershipApplied, false);
    await f.database.upsertAiNovelBillingMembership({ ...(await f.database.findAiNovelBillingMembership("ai_novel", "user_alice"))!, active: false, state: "expired", expiresAt: "2026-10-17T00:00:00Z" });
    await f.service.recoverOrders();
    assert.equal((await f.database.findAiNovelAlipayOrder(id))!.membershipApplied, true);
    assert.equal(f.queried.length, 0); // persisted verified payment needs no new provider query
  } finally { await f.close(); }
});

test("pending records rotate fairly and other merchant/environment records are excluded", async () => {
  const f = await fixture();
  try {
    f.unpaid();
    const first = await f.create("recovery_rotate1");
    await f.create("recovery_rotate2");
    const old = (await f.database.findAiNovelAlipayOrder(first))!;
    await f.database.saveAiNovelAlipayOrder({ ...old, orderId: `alp_${'e'.repeat(32)}`, idempotencyKey: "foreign", environment: "production" });
    await f.service.recoverOrders(1); await f.service.recoverOrders(1);
    assert.equal(new Set(f.queried).size, 2);
    assert.equal(f.queried.includes(`alp_${'e'.repeat(32)}`), false);
  } finally { await f.close(); }
});
