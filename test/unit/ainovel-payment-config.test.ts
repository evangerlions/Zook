import assert from "node:assert/strict";
import test from "node:test";
import { AINOVEL_PAYMENT_IDENTITIES, aiNovelAlipayRuntimeOptions } from "../../src/modules/billing/ainovel-payment-config.ts";
import { alipayConfigured } from "../../src/modules/billing/alipay-policy.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { fixtureFetcher, snapshot } from "../support/revenuecat-v2-fixtures.ts";
import { inBillingEnvironment } from "../../src/modules/billing/billing-environment.ts";

test("runtime payment mode selects code-owned identity and deployment callbacks", () => {
  const secrets = { ALIPAY_AI_NOVEL_PRIVATE_KEY_PATH: "/secrets/private.pem", ALIPAY_AI_NOVEL_PUBLIC_KEY_PATH: "/secrets/public.pem" };
  const production = aiNovelAlipayRuntimeOptions({ ...secrets, APP_ENV: "online", ALIPAY_AI_NOVEL_ENVIRONMENT: "production" });
  assert.equal(production.appId, AINOVEL_PAYMENT_IDENTITIES.alipay.production);
  assert.equal(production.notifyUrl, "https://app.youwoai.net/api/v1/ai_novel/billing/webhooks/alipay");
  assert.equal(production.returnUrl, "https://orangewrite.cn/app/#/membership");
  assert.equal(alipayConfigured(production), true);
  const dev = aiNovelAlipayRuntimeOptions({ ...secrets, DEPLOY_SLOT: "dev", ALIPAY_AI_NOVEL_ENVIRONMENT: "production" });
  assert.equal(dev.appId, production.appId);
  assert.equal(dev.notifyUrl, "https://app-dev.youwoai.net/api/v1/ai_novel/billing/webhooks/alipay");
  const sandbox = aiNovelAlipayRuntimeOptions({ ...secrets, APP_ENV: "local", ALIPAY_AI_NOVEL_ENVIRONMENT: "sandbox" });
  assert.notEqual(sandbox.appId, production.appId);
  assert.equal(sandbox.appId, AINOVEL_PAYMENT_IDENTITIES.alipay.sandbox);
  assert.equal(alipayConfigured(sandbox), true);
  assert.equal(alipayConfigured(aiNovelAlipayRuntimeOptions({ ...secrets, APP_ENV: "local", ALIPAY_AI_NOVEL_ENVIRONMENT: "production" })), false);
  assert.equal(alipayConfigured(aiNovelAlipayRuntimeOptions({ ...secrets, APP_ENV: "online" })), false);
});

test("RevenueCat uses code-owned project and app identities with injected credentials", t => inBillingEnvironment("sandbox", async () => {
  const seed = buildDefaultSeed();
  seed.appUsers!.push({ id: "payment_identity", appId: "ai_novel", userId: "user_alice", status: "ACTIVE", accountRegion: "GLOBAL", joinedAt: new Date().toISOString() });
  const appId = AINOVEL_PAYMENT_IDENTITIES.revenueCat.appleAppId;
  const runtime = await createApplication({ seed, revenueCat: { secretApiKey: "fixture_secret", now: () => new Date("2026-10-05T00:00:00Z"),
    fetcher: fixtureFetcher(async input => {
      assert.ok(new URL(String(input)).pathname.startsWith(`/v2/projects/${AINOVEL_PAYMENT_IDENTITIES.revenueCat.projectId}/`));
      return Response.json(snapshot());
    }, appId) } });
  t.after(() => runtime.close());
  const result = await runtime.services.aiNovelBillingService.syncMembership({ userId: "user_alice", provider: "revenuecat", requestId: "identities" });
  assert.equal(result.syncStatus, "complete");
  assert.equal(result.membership.tier, "plus");
}));
