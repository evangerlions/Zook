import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { AINOVEL_PAYMENT_IDENTITIES, aiNovelAlipayRuntimeOptions } from "../../src/modules/billing/ainovel-payment-config.ts";
import { alipayConfigured } from "../../src/modules/billing/alipay-policy.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { fixtureFetcher, snapshot } from "../support/revenuecat-v2-fixtures.ts";
import { inBillingEnvironment } from "../../src/modules/billing/billing-environment.ts";

test("deployment alone selects both merchant identities and fixed Secret paths", t => {
  const root = mkdtempSync(join(tmpdir(), "payment-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const environment of ["production", "sandbox"] as const) {
    mkdirSync(join(root, environment));
    for (const name of ["app-private-key.pem", "alipay-public-key.pem"]) writeFileSync(join(root, environment, name), "fixture");
  }
  const local = aiNovelAlipayRuntimeOptions({ APP_ENV: "local" }, root);
  const dev = aiNovelAlipayRuntimeOptions({ APP_ENV: "dev" }, root);
  const online = aiNovelAlipayRuntimeOptions({ APP_ENV: "local", DEPLOY_SLOT: "online" }, root);
  assert.deepEqual(Object.keys(local), ["production", "sandbox"]);
  assert.deepEqual(Object.keys(dev), ["production", "sandbox"]);
  assert.deepEqual(Object.keys(online), ["production"]);
  for (const environment of ["production", "sandbox"] as const) {
    assert.equal(local[environment]!.appId, AINOVEL_PAYMENT_IDENTITIES.alipay[environment]);
    assert.equal(local[environment]!.privateKeyPath, join(root, environment, "app-private-key.pem"));
    assert.equal(alipayConfigured({ ...local[environment], environment }), true);
  }
  assert.equal(local.production!.notifyUrl, undefined);
  assert.equal(dev.production!.notifyUrl, "https://app-dev.youwoai.net/api/v1/ai_novel/billing/webhooks/alipay");
  assert.equal(online.production!.notifyUrl, "https://app.youwoai.net/api/v1/ai_novel/billing/webhooks/alipay");
  assert.equal(online.production!.returnUrl, "https://orangewrite.cn/app/#/membership");
  assert.deepEqual(Object.keys(aiNovelAlipayRuntimeOptions({}, root)), ["production"]);
  rmSync(join(root, "sandbox/alipay-public-key.pem"));
  const incomplete = aiNovelAlipayRuntimeOptions({ APP_ENV: "local" }, root);
  assert.equal(alipayConfigured({ ...incomplete.sandbox, environment: "sandbox" }), false);
  assert.equal(alipayConfigured({ ...incomplete.production, environment: "production" }), true);
  mkdirSync(join(root, "sandbox/alipay-public-key.pem"));
  assert.equal(alipayConfigured({ ...aiNovelAlipayRuntimeOptions({ APP_ENV: "local" }, root).sandbox, environment: "sandbox" }), false);
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
