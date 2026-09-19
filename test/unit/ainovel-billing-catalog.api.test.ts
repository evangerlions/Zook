import assert from "node:assert/strict";
import test from "node:test";

import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { createApplication } from "../support/create-test-application.ts";

function buildAiNovelSeed() {
  const seed = buildDefaultSeed();
  seed.appUsers?.push({
    id: "app_user_alice_ai_novel",
    appId: "ai_novel",
    userId: "user_alice",
    status: "ACTIVE",
    accountRegion: "UNKNOWN",
    joinedAt: "2026-03-03T09:00:00+08:00",
  });
  return seed;
}

test("AINovel billing catalog returns nine mock-priced Alipay products for CN Android", async () => {
  const runtime = await createApplication({ seed: buildAiNovelSeed() });
  const accessToken = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/ai_novel/billing/catalog",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "x-app-id": "ai_novel",
      "x-platform": "android",
      "x-app-region": "CN",
    },
    query: {
      platform: "android",
      distribution: "china_android_store",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.accountRegion, "CN");
  assert.equal(response.body.data.products.length, 9);
  assert.deepEqual(
    response.body.data.products.map(
      (product: { productKey: string }) => product.productKey,
    ),
    [
      "plus_monthly",
      "plus_quarterly",
      "plus_yearly",
      "pro_monthly",
      "pro_quarterly",
      "pro_yearly",
      "max_monthly",
      "max_quarterly",
      "max_yearly",
    ],
  );
  assert.deepEqual(response.body.data.products[0], {
    productKey: "plus_monthly",
    tier: "plus",
    billingPeriod: "P1M",
    providers: [
      {
        provider: "alipay",
        available: true,
        blockedReason: null,
        providerProductId: "mock_alipay_plus_monthly",
        providerPackageId: null,
        providerEntitlementId: "plus",
        price: { amountMinor: 3990, currency: "CNY" },
      },
    ],
  });
});

test("AINovel billing catalog keeps global Web unavailable until RC Web is enabled", async () => {
  const runtime = await createApplication({ seed: buildAiNovelSeed() });
  const accessToken = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/ai_novel/billing/catalog",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "x-app-id": "ai_novel",
      "x-platform": "web",
      "x-app-region": "GLOBAL",
    },
    query: { platform: "web", distribution: "web" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.accountRegion, "GLOBAL");
  assert.deepEqual(response.body.data.products[0]?.providers[0], {
    provider: "revenuecat",
    available: false,
    blockedReason: "provider_unavailable",
    providerProductId: null,
    providerPackageId: null,
            providerEntitlementId: "plus",
    price: null,
  });
});

test("AINovel billing catalog rejects Google Play for a CN Android account", async () => {
  const runtime = await createApplication({ seed: buildAiNovelSeed() });
  const accessToken = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/ai_novel/billing/catalog",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "x-app-id": "ai_novel",
      "x-platform": "android",
      "x-app-region": "CN",
    },
    query: { platform: "android", distribution: "google_play" },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "REQ_INVALID_QUERY");
});

test("AINovel billing catalog rejects unsupported query values", async () => {
  const runtime = await createApplication({ seed: buildAiNovelSeed() });
  const accessToken = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/ai_novel/billing/catalog",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "x-app-id": "ai_novel",
    },
    query: { platform: "linux", distribution: "web" },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "REQ_INVALID_QUERY");
});

test("AINovel billing catalog rejects the removed googlecn channel value", async () => {
  const runtime = await createApplication({ seed: buildAiNovelSeed() });
  const accessToken = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/ai_novel/billing/catalog",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "x-app-id": "ai_novel",
      "x-platform": "android",
      "x-app-region": "CN",
    },
    query: { platform: "android", distribution: "googlecn" },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "REQ_INVALID_QUERY");
});
