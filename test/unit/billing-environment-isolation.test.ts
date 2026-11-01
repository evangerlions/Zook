import { confirmAlipayOrder } from "../../src/services/ainovel-alipay-confirmation.ts";
import type { AlipayOrder } from "../../src/modules/billing/alipay-models.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { billingEnvironment, billingRequestEnvironment, inBillingEnvironment } from "../../src/modules/billing/billing-environment.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { InMemoryAiNovelCreditsStore } from "../../src/testing/in-memory-ai-novel-credits-store.ts";
import { AiNovelCreditsService } from "../../src/modules/ai-novel/credits/ai-novel-credits.service.ts";
import { createApplication } from "../support/create-test-application.ts";
import { fixtureFetcher, snapshot } from "../support/revenuecat-v2-fixtures.ts";

const membership = { appId: "ai_novel" as const, userId: "user_alice", active: true, state: "active" as const,
  tier: "plus" as const, planKey: "plus_monthly", expiresAt: "2099-01-01T00:00:00Z", autoRenew: false,
  source: "app_store" as const, managementUrl: null, lastSyncedAt: "2026-10-23T00:00:00Z", accountDeletedAt: null };

test("online rejects sandbox overrides even when an old debug preference is supplied", async () => {
  const runtime = await createApplication({ billingEnvironment: { allowSandbox: false }, revenueCat: { allowSandbox: true } });
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "ai_novel");
  const response = await runtime.app.handle({ method: "GET", path: "/api/v1/users/me",
    headers: { authorization: `Bearer ${token}`, "x-app-id": "ai_novel", "x-billing-environment": "sandbox" } });
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, "BILLING_ENVIRONMENT_FORBIDDEN");
  assert.equal(billingRequestEnvironment({ headers: {} } as any, { allowSandbox: false, defaultEnvironment: "sandbox" }), "production");
  await runtime.close();
});

test("simultaneous environment requests do not share a projection or async context", async () => {
  const db = new InMemoryDatabase({});
  await inBillingEnvironment("sandbox", () => db.upsertAiNovelBillingMembership(membership));
  assert.equal(await db.findAiNovelBillingMembership("ai_novel", "user_alice"), undefined);
  await db.upsertAiNovelBillingMembership({ ...membership, tier: "pro", planKey: "pro_yearly" });
  await Promise.all((["sandbox", "production"] as const).map(env => inBillingEnvironment(env, async () => {
    await new Promise(resolve => setTimeout(resolve, env === "sandbox" ? 5 : 1));
    assert.equal(billingEnvironment(), env);
    const record = await db.findAiNovelBillingMembership("ai_novel", "user_alice");
    assert.equal(record?.tier, env === "sandbox" ? "plus" : "pro");
  })));
  assert.equal(billingEnvironment(), "production");
});

test("sandbox quota, gifts and active jobs never become production credits", async () => {
  const store = new InMemoryAiNovelCreditsStore();
  const service = new AiNovelCreditsService(store, async () => billingEnvironment()==="sandbox" ? "pro" : "free");
  await inBillingEnvironment("sandbox", async () => {
    const balance = await service.balance("user_alice");
    assert.equal(balance.periodicLimit, 4000);
    await service.begin("user_alice", "same_job", "sandbox_request");
  });
  const production = await service.balance("user_alice");
  assert.equal(production.tier, "free");
  assert.equal(production.remainingPoints, 200);
  assert.equal(await service.begin("user_alice", "same_job", "production_request"), "allowed");
  assert.equal((await inBillingEnvironment("sandbox",()=>service.balance("user_alice"))).periodicLimit,4000);
});

test("RevenueCat mixed receipts select only the requested environment and persist both independently", async () => {
  const mixed = snapshot({
    entitlements: {
      orangewrite_plus: { productKey:"plus_monthly",expiresAt:"2099-01-01T00:00:00Z" },
      orangewrite_pro: { productKey:"pro_yearly",expiresAt:"2099-01-01T00:00:00Z" },
    },
    subscriptions: {
      plus_monthly: { store:"app_store",transactionId:"live_plus",sandbox:false,purchasedAt:"2026-09-23T10:00:00Z",expiresAt:"2099-01-01T00:00:00Z" },
      pro_yearly: { store:"app_store",transactionId:"sandbox_pro",sandbox:true,purchasedAt:"2026-09-23T10:00:00Z",expiresAt:"2099-01-01T00:00:00Z" },
    },
  });
  const seed=buildDefaultSeed();
  seed.appUsers!.push({id:"billing_environment_user",appId:"ai_novel",userId:"user_alice",status:"ACTIVE",accountRegion:"GLOBAL",joinedAt:new Date().toISOString()});
  const runtime = await createApplication({ seed, billingEnvironment:{allowSandbox:true},revenueCat:{
    allowSandbox:true,secretApiKey:"test_secret",projectId:"proj_test",appId:"app_test",
    fetcher:fixtureFetcher(async()=>Response.json(mixed),"app_test"),
  }});
  for(const env of ["sandbox","production"] as const){
    const result=await inBillingEnvironment(env,()=>runtime.services.aiNovelBillingService.syncMembership({ provider: "revenuecat",userId:"user_alice",requestId:`test_${env}`}));
    assert.equal(result.syncStatus,"complete");
    assert.equal(result.membership.tier,env==="sandbox"?"pro":"plus");
  }
  assert.equal((await runtime.services.aiNovelBillingService.getMembership("user_alice")).tier,"plus");
  assert.equal((await inBillingEnvironment("sandbox",()=>runtime.services.aiNovelBillingService.getMembership("user_alice"))).tier,"pro");
  await runtime.close();
});


for (const environment of ["sandbox", "production"] as const) {
  test(`Alipay ${environment} renewal ignores the other environment's later expiry`, async () => {
    const seed = buildDefaultSeed();
    seed.appUsers!.push({id:"alipay_env_user",appId:"ai_novel",userId:"user_alice",status:"ACTIVE",accountRegion:"CN",joinedAt:"2026-10-23T00:00:00Z"});
    const db = new InMemoryDatabase(seed);
    const order: AlipayOrder = {orderId:"alp_"+"a".repeat(32),appId:"ai_novel",userId:"user_alice",provider:"alipay",
      merchantAppId:"merchant",sellerId:"",environment,platform:"web",distribution:"web",productKey:"plus_monthly",idempotencyKey:"current_order",
      status:"pending",amountMinor:3800,currency:"CNY",createdAt:"2026-10-23T00:00:00Z",expiresAt:"2026-10-23T00:30:00Z",
      paidAt:null,providerTransactionId:null,membershipApplied:false,membershipExpiresAt:null,conflict:null,accountDeletedAt:null};
    const other = environment === "sandbox" ? "production" : "sandbox";
    await db.saveAiNovelAlipayOrder({...order,orderId:"alp_"+"b".repeat(32),idempotencyKey:"other_order",environment:other,
      status:"paid",membershipApplied:true,paidAt:"2026-10-22T00:00:00Z",membershipExpiresAt:"2030-01-01T00:00:00Z"});
    await db.saveAiNovelAlipayOrder(order);
    const result=await confirmAlipayOrder(db,{appId:"merchant",environment},
      {out_trade_no:order.orderId,trade_no:"202610231234567890",trade_status:"TRADE_SUCCESS",total_amount:"38.00",send_pay_date:"2026-10-23 08:00:10"},
      "query",new Date("2026-10-23T00:00:12Z"));
    assert.equal(result.membershipExpiresAt,"2026-11-23T00:00:10.000Z");
    assert.equal((await inBillingEnvironment(environment,()=>db.findAiNovelBillingMembership("ai_novel","user_alice")))?.active,true);
    assert.equal(await inBillingEnvironment(other,()=>db.findAiNovelBillingMembership("ai_novel","user_alice")),undefined);
  });
}
