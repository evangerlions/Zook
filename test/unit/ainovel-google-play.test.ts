import assert from "node:assert/strict";
import test from "node:test";
import { billingProductKey } from "../../src/modules/billing/ainovel-store-products.ts";
import { buildAiNovelBillingCatalog } from "../../src/modules/billing/ainovel-billing-catalog.ts";
import { normalizeRevenueCatSnapshot } from "../../src/modules/billing/ainovel-revenuecat-normalizer.ts";
import { normalizeRevenueCatWebhookTransaction } from "../../src/modules/billing/ainovel-revenuecat-webhook.ts";
import { RevenueCatCustomerApi } from "../../src/services/ainovel-revenuecat-client.ts";
import { fixtureFetcher, snapshot } from "../support/revenuecat-v2-fixtures.ts";
import { createApplication } from "../support/create-test-application.ts";

test("store product mapping is exact and rejects other base plans/cross-store identities", () => {
  for (const key of ["plus_monthly", "plus_quarterly", "plus_yearly", "pro_monthly", "pro_quarterly", "pro_yearly"]) {
    assert.equal(billingProductKey("play_store", `${key}:auto-renew`), key);
    assert.equal(billingProductKey("app_store", key), key);
    assert.equal(billingProductKey("play_store", key), undefined);
    assert.equal(billingProductKey("play_store", `${key}:prepaid`), undefined);
    assert.equal(billingProductKey("app_store", `${key}:auto-renew`), undefined);
  }
  const catalog = buildAiNovelBillingCatalog({ accountRegion: "GLOBAL", platform: "android", distribution: "google_play" });
  assert.ok(catalog.products.every(p => p.providers[0].providerProductId === `${p.productKey}:auto-renew`));
});

function googleFixture() {
  return snapshot({ entitlements: { orangewrite_plus: { productKey: "plus_monthly:auto-renew", expiresAt: "2026-10-23T10:00:00Z" } },
    subscriptions: { "plus_monthly:auto-renew": { store: "play_store", transactionId: "google_tx", purchasedAt: "2026-09-23T10:00:00Z", expiresAt: "2026-10-23T10:00:00Z", sandbox: true } } });
}

test("Google V2 scopes by its own app, normalizes canonical planKey and preserves provider ID", async () => {
  const fetcher = fixtureFetcher(async () => Response.json(googleFixture()), "google_app");
  const api = new RevenueCatCustomerApi({ secretApiKey: "mock", projectId: "proj_test", appId: "apple_app", googleAppId: "google_app", fetcher });
  const evidence = await api.getSnapshot("user");
  const result = normalizeRevenueCatSnapshot(evidence, "user", new Date("2026-09-24"), { allowSandbox: true });
  assert.equal(result.membership.active, true); assert.equal(result.membership.planKey, "plus_monthly");
  assert.equal(result.membership.source, "play_store");
  assert.equal(result.transactions[0].productId, "plus_monthly:auto-renew");
  assert.equal(result.transactions[0].productKey, "plus_monthly");
  for (const googleAppId of [undefined, "another_app"]) {
    const wrong = new RevenueCatCustomerApi({ secretApiKey: "mock", projectId: "proj_test", appId: "google_app", googleAppId, fetcher });
    assert.deepEqual((await wrong.getSnapshot("user")).subscriptions, []);
  }
});

test("Google webhook financial evidence uses the same canonical identity and rejects unknown base plans", () => {
  const event = { product_id: "pro_yearly:auto-renew", store: "PLAY_STORE", type: "RENEWAL", transaction_id: "GPA.mock", environment: "SANDBOX", currency: "USD", price_in_purchased_currency: 149.99 };
  const input = { event, userId: "user", observedAt: "2026-10-04T00:00:00Z" };
  const row = normalizeRevenueCatWebhookTransaction(input)!;
  assert.equal(row.productId, "pro_yearly:auto-renew"); assert.equal(row.productKey, "pro_yearly"); assert.equal(row.amountMinor, 14999);
  assert.equal(normalizeRevenueCatWebhookTransaction({ ...input, event: { ...event, product_id: "pro_yearly:prepaid" } }), undefined);
});

test("webhook rejects cross-store app IDs even when both apps are configured", async () => {
  const runtime = await createApplication({ revenueCat: {
    secretApiKey: "mock", projectId: "proj_test", appId: "apple_app",
    googleAppId: "google_app", webhookAuthorization: "Bearer mock", allowSandbox: true,
    fetcher: fixtureFetcher(async () => Response.json(googleFixture()), "google_app"),
  } });
  for (const [appId, store, expected] of [
    ["apple_app", "PLAY_STORE", 403], ["google_app", "APP_STORE", 403],
    ["google_app", "PLAY_STORE", 200], ["apple_app", "APP_STORE", 200],
  ] as const) {
    const response = await runtime.app.handle({ method: "POST",
      path: "/api/v1/ai_novel/billing/webhooks/revenuecat",
      headers: { authorization: "Bearer mock" },
      body: { api_version: "1.0", event: { id: `${appId}-${store}`, type: "TEST",
        app_id: appId, store, environment: "SANDBOX", app_user_id: "user" } },
    });
    assert.equal(response.statusCode, expected);
  }
});
