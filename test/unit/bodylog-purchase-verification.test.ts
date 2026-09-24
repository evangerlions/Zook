import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryBodyLogSubscriptionStore } from "../../src/modules/bodylog/bodylog-stores.ts";
import { BodyLogPurchaseVerificationService } from "../../src/modules/bodylog/bodylog-purchase-verification.service.ts";
import type { BodyLogPurchaseProof, VerifiedBodyLogPurchase } from "../../src/modules/bodylog/bodylog-store-purchase-verifier.ts";
import { ApplicationError } from "../../src/shared/errors.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { createApplication } from "../../test/support/create-test-application.ts";

const purchase: VerifiedBodyLogPurchase = {
  platform: "ios", productId: "com.habitap.onemonth1", tier: "pro",
  startedAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-10-01T00:00:00.000Z",
  autoRenew: false, transactionId: "tx-1", originalTransactionId: "original-1",
};

function service(store = new InMemoryBodyLogSubscriptionStore()) {
  const verifier = { verify: async (_proof: BodyLogPurchaseProof) => purchase };
  return { store, verification: new BodyLogPurchaseVerificationService(store, verifier as never) };
}

test("verified store purchase becomes the cloud entitlement and retries are idempotent", async () => {
  const { store, verification } = service();
  const proof: BodyLogPurchaseProof = { platform: "ios", productId: purchase.productId, signedTransaction: "signed-jws" };

  const first = await verification.verify("user-a", proof);
  const second = await verification.verify("user-a", proof);

  assert.deepEqual(first, { verified: true, tier: "pro", expiresAt: purchase.expiresAt, autoRenew: false });
  assert.deepEqual(second, first);
  assert.equal((await store.findActiveUserSubscription("bodylog", "user-a"))?.tier, "pro");
});

test("a store transaction cannot be claimed by a second BodyLog account", async () => {
  const { verification } = service();
  const proof: BodyLogPurchaseProof = { platform: "ios", productId: purchase.productId, signedTransaction: "signed-jws" };

  await verification.verify("user-a", proof);
  await assert.rejects(
    verification.verify("user-b", proof),
    (error: unknown) => error instanceof ApplicationError && error.code === "BODYLOG_PURCHASE_ALREADY_CLAIMED",
  );
});

test("expired or revoked verified purchase synchronizes as free", async () => {
  const expiredVerifier = {
    verify: async () => ({ ...purchase, expiresAt: "2026-01-01T00:00:00.000Z" }),
  };
  const store = new InMemoryBodyLogSubscriptionStore();
  const verification = new BodyLogPurchaseVerificationService(store, expiredVerifier as never);
  const result = await verification.verify("user-a", {
    platform: "ios", productId: purchase.productId, signedTransaction: "signed-jws",
  });

  assert.equal(result.tier, "free");
  assert.equal(await store.findActiveUserSubscription("bodylog", "user-a"), null);
});

test("purchase verification route requires auth and fails closed when store config is absent", async () => {
  const savedAppleRoots = process.env.BODYLOG_APPLE_ROOT_CA_PATHS;
  const savedGoogleAccount = process.env.BODYLOG_GOOGLE_PLAY_SERVICE_ACCOUNT_PATH;
  delete process.env.BODYLOG_APPLE_ROOT_CA_PATHS;
  delete process.env.BODYLOG_GOOGLE_PLAY_SERVICE_ACCOUNT_PATH;
  try {
    const seed = buildDefaultSeed();
    seed.apps!.push({ id: "bodylog", code: "bodylog", name: "BodyLog", nameI18n: {}, status: "ACTIVE", apiDomain: "bodylog.example.com", joinMode: "AUTO", createdAt: new Date().toISOString() });
    seed.appUsers!.push({ id: "bodylog_user_alice", appId: "bodylog", userId: "user_alice", status: "ACTIVE", joinedAt: new Date().toISOString() });
    const runtime = await createApplication({ seed });
    const path = "/api/v1/bodylog/subscription/purchases";
    const unauthenticated = await runtime.app.handle({ method: "POST", path, headers: {}, body: { platform: "ios", productId: "com.habitap.onemonth1", signedTransaction: "proof" } });
    assert.equal(unauthenticated.statusCode, 401);
    const token = runtime.services.tokenService.issueAccessToken("user_alice", "bodylog");
    const invalid = await runtime.app.handle({ method: "POST", path, headers: { authorization: `Bearer ${token}` }, body: { platform: "ios", productId: "com.habitap.onemonth1" } });
    assert.equal(invalid.statusCode, 400, JSON.stringify(invalid.body));
    const unavailable = await runtime.app.handle({ method: "POST", path, headers: { authorization: `Bearer ${token}` }, body: { platform: "ios", productId: "com.habitap.onemonth1", signedTransaction: "proof" } });
    assert.equal(unavailable.statusCode, 503);
  } finally {
    if (savedAppleRoots === undefined) delete process.env.BODYLOG_APPLE_ROOT_CA_PATHS;
    else process.env.BODYLOG_APPLE_ROOT_CA_PATHS = savedAppleRoots;
    if (savedGoogleAccount === undefined) delete process.env.BODYLOG_GOOGLE_PLAY_SERVICE_ACCOUNT_PATH;
    else process.env.BODYLOG_GOOGLE_PLAY_SERVICE_ACCOUNT_PATH = savedGoogleAccount;
  }
});
