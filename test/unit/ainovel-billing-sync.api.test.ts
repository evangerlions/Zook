import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { createApplication } from "../support/create-test-application.ts";

const API_KEY = "sk_test_server_only_do_not_log";
const WEBHOOK_AUTH = "Bearer webhook-secret-for-tests";
const RC_APP_ID = "rc_app_ainovel_test";

function buildAiNovelSeed() {
  const seed = buildDefaultSeed();
  seed.appUsers?.push({
    id: "app_user_alice_ai_novel",
    appId: "ai_novel",
    userId: "user_alice",
    status: "ACTIVE",
    accountRegion: "GLOBAL",
    joinedAt: "2026-03-03T09:00:00+08:00",
  });
  return seed;
}

function snapshot(overrides: {
  requestDate?: string;
  entitlements?: Record<string, unknown>;
  subscriptions?: Record<string, unknown>;
} = {}) {
  return {
    request_date: overrides.requestDate ?? "2026-09-23T10:00:00Z",
    subscriber: {
      entitlements: overrides.entitlements ?? {
        orangewrite_plus: {
          product_identifier: "plus_monthly",
          expires_date: "2026-10-23T10:00:00Z",
          grace_period_expires_date: null,
        },
      },
      subscriptions: overrides.subscriptions ?? {
        plus_monthly: {
          store: "app_store",
          store_transaction_id: "tx_plus_001",
          purchase_date: "2026-09-23T10:00:00Z",
          original_purchase_date: "2026-09-23T10:00:00Z",
          expires_date: "2026-10-23T10:00:00Z",
          refunded_at: null,
          unsubscribe_detected_at: null,
          is_sandbox: true,
        },
      },
      management_url: "https://apps.apple.com/account/subscriptions",
    },
  };
}

function webhookEvent(overrides: Record<string, unknown> = {}) {
  return {
    api_version: "1.0",
    event: {
      id: "evt_001",
      type: "INITIAL_PURCHASE",
      app_id: RC_APP_ID,
      app_user_id: "user_alice",
      store: "APP_STORE",
      environment: "SANDBOX",
      product_id: "plus_monthly",
      transaction_id: "tx_plus_001",
      event_timestamp_ms: 1790157600000,
      ...overrides,
    },
  };
}

function revenueCatOptions(
  fetcher: typeof fetch,
  now?: () => Date,
  allowSandbox = true,
) {
  return {
    seed: buildAiNovelSeed(),
    revenueCat: {
      secretApiKey: API_KEY,
      webhookAuthorization: WEBHOOK_AUTH,
      appId: RC_APP_ID,
      allowSandbox,
      fetcher,
      now,
    },
  };
}

test("production billing sync excludes sandbox-only RevenueCat entitlements", async () => {
  const runtime = await createApplication(revenueCatOptions(async () =>
    new Response(JSON.stringify(snapshot()), { status: 200 }),
    undefined,
    false,
  ));
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "ai_novel");
  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/billing/sync",
    headers: authHeaders(token),
    body: { reason: "purchase" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.membership.active, false);
  assert.equal(
    (await runtime.database.listAiNovelBillingTransactions("ai_novel", "user_alice")).length,
    0,
  );
});

test("production sync and webhook preserve membership for Sandbox or unknown environment evidence", async () => {
  let providerSnapshot: unknown = snapshot();
  const runtime = await createApplication(revenueCatOptions(async () =>
    new Response(JSON.stringify(providerSnapshot), { status: 200 }),
    undefined,
    false,
  ));
  await runtime.database.upsertAiNovelBillingMembership({
    appId: "ai_novel",
    userId: "user_alice",
    active: true,
    state: "active",
    tier: "plus",
    planKey: "plus_monthly",
    expiresAt: "2026-10-23T10:00:00.000Z",
    autoRenew: true,
    source: "app_store",
    managementUrl: "https://apps.apple.com/account/subscriptions",
    lastSyncedAt: "2026-09-22T10:00:00.000Z",
    accountDeletedAt: null,
  });

  const token = runtime.services.tokenService.issueAccessToken("user_alice", "ai_novel");
  const syncResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/billing/sync",
    headers: authHeaders(token),
    body: { reason: "app_start" },
  });
  assert.equal(syncResponse.statusCode, 200);
  assert.equal(syncResponse.body.data.syncStatus, "pending");
  assert.equal(syncResponse.body.data.membership.active, true);
  assert.equal(syncResponse.body.data.membership.planKey, "plus_monthly");

  const { is_sandbox: _isSandbox, ...subscriptionWithoutEnvironment } =
    snapshot().subscriber.subscriptions.plus_monthly;
  providerSnapshot = snapshot({
    subscriptions: { plus_monthly: subscriptionWithoutEnvironment },
  });
  const unknownEnvironmentSyncResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/billing/sync",
    headers: authHeaders(token),
    body: { reason: "app_start" },
  });
  assert.equal(unknownEnvironmentSyncResponse.body.data.syncStatus, "pending");
  assert.equal(unknownEnvironmentSyncResponse.body.data.membership.active, true);

  const webhookResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/billing/webhooks/revenuecat",
    headers: { authorization: WEBHOOK_AUTH },
    body: webhookEvent({ id: "evt_production_sandbox_snapshot", environment: "PRODUCTION" }),
  });
  assert.equal(webhookResponse.statusCode, 200);
  assert.equal(webhookResponse.body.data.status, "processed");
  const membership = await runtime.database.findAiNovelBillingMembership("ai_novel", "user_alice");
  assert.equal(membership?.active, true);
  assert.equal(membership?.planKey, "plus_monthly");
  assert.equal(membership?.lastSyncedAt, "2026-09-22T10:00:00.000Z");
});

test("production webhook records Sandbox events as ignored without granting membership", async () => {
  let customerLookups = 0;
  const runtime = await createApplication(revenueCatOptions(async () => {
    customerLookups++;
    return new Response(JSON.stringify(snapshot()), { status: 200 });
  }, undefined, false));
  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/billing/webhooks/revenuecat",
    headers: { authorization: WEBHOOK_AUTH },
    body: webhookEvent({ id: "evt_sandbox_rejected" }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.status, "ignored");
  assert.equal(customerLookups, 0);
  assert.equal(
    await runtime.database.findAiNovelBillingMembership("ai_novel", "user_alice"),
    undefined,
  );
});

function authHeaders(accessToken: string) {
  return {
    authorization: `Bearer ${accessToken}`,
    "x-app-id": "ai_novel",
    "x-platform": "ios",
  };
}

test("purchase sync is repeatable, stores provider evidence, and feeds users/me membership", async () => {
  let calls = 0;
  const runtime = await createApplication(revenueCatOptions(async (_input, init) => {
    calls++;
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${API_KEY}`);
    return new Response(JSON.stringify(snapshot()), { status: 200 });
  }));
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "ai_novel");
  const syncRequest = {
    method: "POST",
    path: "/api/v1/ai_novel/billing/sync",
    headers: authHeaders(token),
    body: { reason: "purchase" },
  };

  const first = await runtime.app.handle(syncRequest);
  const second = await runtime.app.handle(syncRequest);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.data.syncStatus, "synchronized");
  assert.deepEqual(first.body.data.membership, {
    active: true,
    state: "active",
    tier: "plus",
    planKey: "plus_monthly",
    expiresAt: "2026-10-23T10:00:00.000Z",
    autoRenew: true,
    source: "app_store",
    managementUrl: "https://apps.apple.com/account/subscriptions",
  });
  assert.equal(second.body.data.syncStatus, "synchronized");
  assert.equal(calls, 2);
  assert.equal((await runtime.database.listAiNovelBillingTransactions("ai_novel", "user_alice")).length, 1);

  const me = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/users/me",
    headers: authHeaders(token),
  });
  assert.equal(me.statusCode, 200);
  assert.equal(me.body.data.membership.active, true);
  assert.equal(me.body.data.membership.planKey, "plus_monthly");
  assert.equal(JSON.stringify(runtime.logger.records).includes(API_KEY), false);
});

test("purchase sync accepts the configured Pro entitlement identifier", async () => {
  const proSnapshot = snapshot({
    entitlements: {
      orangewrite_pro: {
        product_identifier: "pro_monthly",
        expires_date: "2026-10-23T10:00:00Z",
        grace_period_expires_date: null,
      },
    },
    subscriptions: {
      pro_monthly: {
        store: "app_store",
        store_transaction_id: "tx_pro_001",
        purchase_date: "2026-09-23T10:00:00Z",
        original_purchase_date: "2026-09-23T10:00:00Z",
        expires_date: "2026-10-23T10:00:00Z",
        refunded_at: null,
        unsubscribe_detected_at: null,
        is_sandbox: true,
      },
    },
  });
  const runtime = await createApplication(revenueCatOptions(async () =>
    new Response(JSON.stringify(proSnapshot), { status: 200 })
  ));
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "ai_novel");
  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/billing/sync",
    headers: authHeaders(token),
    body: { reason: "purchase" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.syncStatus, "synchronized");
  assert.equal(response.body.data.membership.tier, "pro");
  assert.equal(response.body.data.membership.planKey, "pro_monthly");
});

test("sync rejects client-supplied identity, receipt, product, and entitlement fields", async () => {
  let calls = 0;
  const runtime = await createApplication(revenueCatOptions(async () => {
    calls++;
    return new Response(JSON.stringify(snapshot()), { status: 200 });
  }));
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "ai_novel");
  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/billing/sync",
    headers: authHeaders(token),
    body: { reason: "purchase", userId: "someone-else", receipt: "forged" },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(calls, 0);
});

test("unknown product or mismatched entitlement never grants membership", async () => {
  const cases = [
    snapshot({
      entitlements: {
        unknown_entitlement: { product_identifier: "plus_monthly", expires_date: "2026-10-23T10:00:00Z" },
      },
    }),
    snapshot({
      entitlements: {
        orangewrite_plus: { product_identifier: "unlisted_monthly", expires_date: "2026-10-23T10:00:00Z" },
      },
      subscriptions: {
        unlisted_monthly: { store: "app_store", expires_date: "2026-10-23T10:00:00Z" },
      },
    }),
    snapshot({
      entitlements: {
        orangewrite_pro: { product_identifier: "plus_monthly", expires_date: "2026-10-23T10:00:00Z" },
      },
    }),
    snapshot({
      entitlements: {
        max: { product_identifier: "max_monthly", expires_date: "2026-10-23T10:00:00Z" },
      },
      subscriptions: {
        max_monthly: { store: "app_store", expires_date: "2026-10-23T10:00:00Z" },
      },
    }),
  ];
  for (const customer of cases) {
    const runtime = await createApplication(revenueCatOptions(async () =>
      new Response(JSON.stringify(customer), { status: 200 })
    ));
    const token = runtime.services.tokenService.issueAccessToken("user_alice", "ai_novel");
    const response = await runtime.app.handle({
      method: "POST",
      path: "/api/v1/ai_novel/billing/sync",
      headers: authHeaders(token),
      body: { reason: "restore" },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.membership.active, false);
    assert.equal(response.body.data.membership.tier, null);
  }
});

test("refunded/expired provider snapshot revokes previously active membership", async () => {
  let current = snapshot();
  const runtime = await createApplication(revenueCatOptions(async () =>
    new Response(JSON.stringify(current), { status: 200 })
  ));
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "ai_novel");
  const request = {
    method: "POST",
    path: "/api/v1/ai_novel/billing/sync",
    headers: authHeaders(token),
    body: { reason: "retry" },
  };
  assert.equal((await runtime.app.handle(request)).body.data.membership.active, true);
  current = snapshot({
    entitlements: {},
    subscriptions: {
      plus_monthly: {
        store: "app_store",
        store_transaction_id: "tx_plus_001",
        purchase_date: "2026-08-23T10:00:00Z",
        original_purchase_date: "2026-08-23T10:00:00Z",
        expires_date: "2026-09-01T10:00:00Z",
        refunded_at: "2026-09-20T10:00:00Z",
        unsubscribe_detected_at: "2026-08-25T10:00:00Z",
        is_sandbox: true,
      },
    },
  });
  const revoked = await runtime.app.handle(request);
  assert.equal(revoked.body.data.membership.active, false);
  const rows = await runtime.database.listAiNovelBillingTransactions("ai_novel", "user_alice");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.status, "refunded");
});

test("provider outage returns pending and preserves last confirmed membership", async () => {
  let unavailable = false;
  const runtime = await createApplication(revenueCatOptions(async () => {
    if (unavailable) throw new Error(`network failure ${API_KEY}`);
    return new Response(JSON.stringify(snapshot()), { status: 200 });
  }));
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "ai_novel");
  const request = {
    method: "POST",
    path: "/api/v1/ai_novel/billing/sync",
    headers: authHeaders(token),
  };
  await runtime.app.handle(request);
  unavailable = true;
  const response = await runtime.app.handle(request);
  assert.equal(response.body.data.syncStatus, "pending");
  assert.equal(response.body.data.membership.active, true);
  assert.equal(JSON.stringify(runtime.logger.records).includes(API_KEY), false);
});

test("provider outage cannot keep a membership active after its effective expiry", async () => {
  let unavailable = false;
  let now = new Date("2026-09-23T10:00:00Z");
  const runtime = await createApplication(revenueCatOptions(async () => {
    if (unavailable) throw new Error("network failure");
    return new Response(JSON.stringify(snapshot()), { status: 200 });
  }, () => now));
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "ai_novel");
  const request = {
    method: "POST",
    path: "/api/v1/ai_novel/billing/sync",
    headers: authHeaders(token),
  };
  await runtime.app.handle(request);

  now = new Date("2026-10-24T10:00:00Z");
  unavailable = true;
  const response = await runtime.app.handle(request);
  assert.equal(response.body.data.syncStatus, "pending");
  assert.equal(response.body.data.membership.active, false);
  assert.equal(response.body.data.membership.state, "expired");

  const me = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/users/me",
    headers: authHeaders(token),
  });
  assert.equal(me.body.data.membership.active, false);
  assert.equal(me.body.data.membership.state, "expired");
});

test("effective membership expiry preserves access through RevenueCat grace period", async () => {
  const now = new Date("2026-09-23T10:00:00Z");
  const customer = snapshot({
    entitlements: {
      orangewrite_plus: {
        product_identifier: "plus_monthly",
        expires_date: "2026-09-22T10:00:00Z",
        grace_period_expires_date: "2026-09-24T10:00:00Z",
      },
    },
    subscriptions: {
      plus_monthly: {
        store: "app_store",
        store_transaction_id: "tx_plus_grace",
        purchase_date: "2026-08-23T10:00:00Z",
        original_purchase_date: "2026-08-23T10:00:00Z",
        expires_date: "2026-09-22T10:00:00Z",
        refunded_at: null,
        unsubscribe_detected_at: null,
        is_sandbox: true,
      },
    },
  });
  const runtime = await createApplication(revenueCatOptions(async () =>
    new Response(JSON.stringify(customer), { status: 200 }),
  () => now));
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "ai_novel");
  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/billing/sync",
    headers: authHeaders(token),
  });

  assert.equal(response.body.data.membership.active, true);
  assert.equal(response.body.data.membership.state, "grace_period");
  assert.equal(response.body.data.membership.expiresAt, "2026-09-24T10:00:00.000Z");
});

test("sync finishing after account deletion does not recreate billing access", async () => {
  let runtime: Awaited<ReturnType<typeof createApplication>> | undefined;
  runtime = await createApplication(revenueCatOptions(async () => {
    await runtime?.database.withExclusiveSession(async () => {
      await runtime?.database.deleteAppUserRuntimeData("ai_novel", "user_alice");
      await runtime?.database.updateAppUserStatus("ai_novel", "user_alice", "DELETED");
    });
    return new Response(JSON.stringify(snapshot()), { status: 200 });
  }));
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "ai_novel");
  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/billing/sync",
    headers: authHeaders(token),
  });
  assert.equal(response.body.data.membership.active, false);
  assert.equal(await runtime.database.findAiNovelBillingMembership("ai_novel", "user_alice"), undefined);
  const transactions = await runtime.database.listAiNovelBillingTransactions("ai_novel", "user_alice");
  assert.equal(transactions.length, 0);
});

test("RevenueCat webhook requires configured auth, refreshes authoritative data, and deduplicates", async () => {
  let calls = 0;
  const runtime = await createApplication(revenueCatOptions(async () => {
    calls++;
    return new Response(JSON.stringify(snapshot()), { status: 200 });
  }, () => new Date("2026-09-24T00:00:00.000Z")));
  const request = {
    method: "POST",
    path: "/api/v1/ai_novel/billing/webhooks/revenuecat",
    headers: { authorization: WEBHOOK_AUTH },
    body: webhookEvent({
      price_in_purchased_currency: 9.99,
      currency: "USD",
      purchased_at_ms: 1790157600000,
    }),
  };
  const unauthorized = await runtime.app.handle({ ...request, headers: { authorization: "wrong" } });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(calls, 0);

  const accepted = await runtime.app.handle(request);
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.data.status, "processed");
  assert.equal(calls, 1);
  assert.equal((await runtime.app.handle(request)).body.data.status, "duplicate");
  assert.equal(calls, 1);
  const event = await runtime.database.findAiNovelBillingWebhookEvent("ai_novel", "evt_001");
  assert.equal(event?.status, "processed");
  assert.equal(event?.providerTransactionId, "tx_plus_001");
  const tx = await runtime.database.listAiNovelBillingTransactions("ai_novel", "user_alice");
  assert.equal(tx[0]?.amountMinor, 999);
  assert.equal(tx[0]?.currency, "USD");
  const me = await runtime.app.handle({ method: "GET", path: "/api/v1/users/me", headers: authHeaders(runtime.services.tokenService.issueAccessToken("user_alice", "ai_novel")) });
  assert.equal(me.body.data.membership.active, true);
  assert.equal(JSON.stringify(runtime.logger.records).includes(WEBHOOK_AUTH), false);
});

test("RevenueCat TRANSFER webhook reconciles every known source and destination user", async () => {
  let aliceLookups = 0;
  const options = revenueCatOptions(async (input) => {
    const url = String(input);
    if (url.endsWith("/user_alice")) {
      aliceLookups++;
      const data = aliceLookups === 1
        ? snapshot()
        : snapshot({ entitlements: {}, subscriptions: {} });
      return new Response(JSON.stringify(data), { status: 200 });
    }
    if (url.endsWith("/user_bob")) {
      return new Response(JSON.stringify(snapshot()), { status: 200 });
    }
    throw new Error(`Unexpected RevenueCat customer URL: ${url}`);
  }, () => new Date("2026-09-24T00:00:00.000Z"));
  options.seed.appUsers?.push({
    id: "app_user_bob_ai_novel",
    appId: "ai_novel",
    userId: "user_bob",
    status: "ACTIVE",
    accountRegion: "GLOBAL",
    joinedAt: "2026-03-03T09:00:00+08:00",
  });
  const runtime = await createApplication(options);
  const webhookPath = "/api/v1/ai_novel/billing/webhooks/revenuecat";

  const purchased = await runtime.app.handle({
    method: "POST",
    path: webhookPath,
    headers: { authorization: WEBHOOK_AUTH },
    body: webhookEvent(),
  });
  assert.equal(purchased.statusCode, 200);
  assert.equal(
    (await runtime.database.findAiNovelBillingMembership("ai_novel", "user_alice"))?.active,
    true,
  );

  const transfer = webhookEvent({
    id: "evt_transfer",
    type: "TRANSFER",
    transferred_from: ["user_alice"],
    transferred_to: ["user_bob"],
  });
  delete transfer.event.app_user_id;
  delete transfer.event.store;
  delete transfer.event.environment;
  delete transfer.event.product_id;
  delete transfer.event.transaction_id;
  const transferred = await runtime.app.handle({
    method: "POST",
    path: webhookPath,
    headers: { authorization: WEBHOOK_AUTH },
    body: transfer,
  });

  assert.equal(transferred.statusCode, 200);
  assert.equal(transferred.body.data.status, "processed");
  assert.equal(
    (await runtime.database.findAiNovelBillingMembership("ai_novel", "user_alice"))?.active,
    false,
  );
  assert.equal(
    (await runtime.database.findAiNovelBillingMembership("ai_novel", "user_bob"))?.active,
    true,
  );
  const transferEvent = await runtime.database.findAiNovelBillingWebhookEvent(
    "ai_novel",
    "evt_transfer",
  );
  assert.equal(transferEvent?.userId, "user_bob");
  assert.deepEqual(transferEvent?.affectedUserIds, ["user_alice", "user_bob"]);
  assert.equal(transferEvent?.accountDeletedAt, null);
  const sourceHistory = await runtime.database.listAiNovelBillingAdminEvents({
    appId: "ai_novel",
    userId: "user_alice",
    providerTransactionId: "tx_plus_001",
    limit: 20,
  });
  const destinationHistory = await runtime.database.listAiNovelBillingAdminEvents({
    appId: "ai_novel",
    userId: "user_bob",
    providerTransactionId: "tx_plus_001",
    limit: 20,
  });
  assert.equal(sourceHistory.items.some((event) => event.eventId === "evt_transfer"), true);
  assert.equal(destinationHistory.items.some((event) => event.eventId === "evt_transfer"), true);
});

test("RevenueCat TRANSFER audit records the linked deleted-account marker", async () => {
  const customerLookups: string[] = [];
  const options = revenueCatOptions(async (input) => {
    const url = String(input);
    customerLookups.push(url);
    if (url.endsWith("/user_bob")) {
      return new Response(JSON.stringify(snapshot()), { status: 200 });
    }
    throw new Error("Deleted users must not be looked up during transfer.");
  });
  const alice = options.seed.appUsers?.find((user) =>
    user.appId === "ai_novel" && user.userId === "user_alice"
  );
  assert.ok(alice);
  alice.status = "DELETED";
  alice.updatedAt = "2026-09-20T12:00:00.000Z";
  options.seed.appUsers?.push({
    id: "app_user_bob_ai_novel",
    appId: "ai_novel",
    userId: "user_bob",
    status: "ACTIVE",
    accountRegion: "GLOBAL",
    joinedAt: "2026-03-03T09:00:00+08:00",
  });
  const runtime = await createApplication(options);
  const transfer = webhookEvent({
    id: "evt_transfer_deleted_source",
    type: "TRANSFER",
    transferred_from: ["user_alice"],
    transferred_to: ["user_bob"],
  });
  delete transfer.event.app_user_id;
  delete transfer.event.store;
  delete transfer.event.environment;
  delete transfer.event.product_id;
  delete transfer.event.transaction_id;

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/billing/webhooks/revenuecat",
    headers: { authorization: WEBHOOK_AUTH },
    body: transfer,
  });
  const event = await runtime.database.findAiNovelBillingWebhookEvent(
    "ai_novel",
    "evt_transfer_deleted_source",
  );

  assert.equal(
    response.body.data?.status,
    "processed",
    `${JSON.stringify(response.body)}; customer lookups: ${customerLookups.join(",")}`,
  );
  assert.deepEqual(customerLookups.map((url) => url.split("/").at(-1)), ["user_bob"]);
  assert.equal(event?.accountDeletedAt, "2026-09-20T12:00:00.000Z");
  assert.deepEqual(event?.affectedUserIds, ["user_alice", "user_bob"]);
});

test("older verified webhook backfills financial facts without regressing a newer snapshot", async () => {
  const snapshotObservedAt = "2026-09-23T10:00:00.000Z";
  const webhookOccurredAt = "2026-09-22T10:00:00.000Z";
  const runtime = await createApplication(revenueCatOptions(async () =>
    new Response(JSON.stringify(snapshot({ requestDate: snapshotObservedAt })), { status: 200 }),
  () => new Date("2026-09-24T00:00:00.000Z")));

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/billing/webhooks/revenuecat",
    headers: { authorization: WEBHOOK_AUTH },
    body: webhookEvent({
      id: "evt_older_financial_facts",
      event_timestamp_ms: Date.parse(webhookOccurredAt),
      price_in_purchased_currency: 9.99,
      currency: "USD",
    }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.status, "processed");
  const [transaction] = await runtime.database.listAiNovelBillingTransactions("ai_novel", "user_alice");
  assert.equal(transaction?.amountMinor, 999);
  assert.equal(transaction?.currency, "USD");
  assert.equal(transaction?.observedAt, snapshotObservedAt);
  assert.equal(transaction?.status, "entitlement_active");
});

test("snapshot can confirm membership without inventing a financial transaction ID", async () => {
  const noTransactionIdSnapshot = snapshot({
    subscriptions: {
      plus_monthly: {
        store: "app_store",
        store_transaction_id: null,
        purchase_date: "2026-09-23T10:00:00Z",
        original_purchase_date: "2026-09-23T10:00:00Z",
        expires_date: "2026-10-23T10:00:00Z",
        refunded_at: null,
        unsubscribe_detected_at: null,
        is_sandbox: true,
      },
    },
  });
  const runtime = await createApplication(revenueCatOptions(async () =>
    new Response(JSON.stringify(noTransactionIdSnapshot), { status: 200 }),
  ));
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "ai_novel");

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/billing/sync",
    headers: authHeaders(token),
    body: { reason: "purchase" },
  });

  assert.equal(response.body.data.membership.active, true);
  assert.deepEqual(await runtime.database.listAiNovelBillingTransactions("ai_novel", "user_alice"), []);
});

test("RevenueCat webhook rejects app mismatch and safely ignores unknown event types", async () => {
  let calls = 0;
  const runtime = await createApplication(revenueCatOptions(async () => {
    calls++;
    return new Response(JSON.stringify(snapshot()), { status: 200 });
  }));
  const baseRequest = {
    method: "POST",
    path: "/api/v1/ai_novel/billing/webhooks/revenuecat",
    headers: { authorization: WEBHOOK_AUTH },
  };
  const mismatch = await runtime.app.handle({ ...baseRequest, body: webhookEvent({ app_id: "wrong-app" }) });
  assert.equal(mismatch.statusCode, 403);
  const ignored = await runtime.app.handle({ ...baseRequest, body: webhookEvent({ id: "evt_unknown", type: "TEST" }) });
  assert.equal(ignored.statusCode, 200);
  assert.equal(ignored.body.data.status, "ignored");
  assert.equal(calls, 0);

  const unsupportedStore = await runtime.app.handle({
    ...baseRequest,
    body: webhookEvent({ id: "evt_unsupported_store", store: "STRIPE" }),
  });
  assert.equal(unsupportedStore.statusCode, 200);
  assert.equal(unsupportedStore.body.data.status, "ignored");
  assert.equal(calls, 0);
});

test("subscription extension and pause events refresh authoritative access without revoking it", async () => {
  let expiresAt = "2026-10-23T10:00:00Z";
  const runtime = await createApplication(revenueCatOptions(async () =>
    new Response(JSON.stringify(snapshot({
      entitlements: {
        orangewrite_plus: {
          product_identifier: "plus_monthly",
          expires_date: expiresAt,
          grace_period_expires_date: null,
        },
      },
      subscriptions: {
        plus_monthly: {
          store: "play_store",
          store_transaction_id: "tx_plus_001",
          purchase_date: "2026-09-23T10:00:00Z",
          original_purchase_date: "2026-09-23T10:00:00Z",
          expires_date: expiresAt,
          refunded_at: null,
          unsubscribe_detected_at: null,
          is_sandbox: true,
        },
      },
    })), { status: 200 }),
  () => new Date("2026-09-24T00:00:00Z")));
  const request = (id: string, type: string) => runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/billing/webhooks/revenuecat",
    headers: { authorization: WEBHOOK_AUTH },
    body: webhookEvent({ id, type, store: "PLAY_STORE" }),
  });

  expiresAt = "2026-11-23T10:00:00Z";
  const extended = await request("evt_extended", "SUBSCRIPTION_EXTENDED");
  assert.equal(extended.body.data.status, "processed");
  const afterExtension = await runtime.database.findAiNovelBillingMembership("ai_novel", "user_alice");
  assert.equal(afterExtension?.active, true);
  assert.equal(afterExtension?.expiresAt, "2026-11-23T10:00:00.000Z");

  const paused = await request("evt_paused", "SUBSCRIPTION_PAUSED");
  assert.equal(paused.body.data.status, "processed");
  const afterPause = await runtime.database.findAiNovelBillingMembership("ai_novel", "user_alice");
  assert.equal(afterPause?.active, true);
  assert.equal(afterPause?.state, "active");
});

test("RevenueCat customer-support cancellation refund stores positive minor-unit amount", async () => {
  const runtime = await createApplication(revenueCatOptions(async () =>
    new Response(JSON.stringify(snapshot()), { status: 200 }),
  () => new Date("2026-09-24T00:00:00.000Z")));
  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/billing/webhooks/revenuecat",
    headers: { authorization: WEBHOOK_AUTH },
    body: webhookEvent({
      id: "evt_refund",
      type: "CANCELLATION",
      cancel_reason: "CUSTOMER_SUPPORT",
      price_in_purchased_currency: -9.99,
      currency: "USD",
    }),
  });
  assert.equal(response.statusCode, 200);
  const [transaction] = await runtime.database.listAiNovelBillingTransactions("ai_novel", "user_alice");
  assert.equal(transaction?.status, "refunded");
  assert.equal(transaction?.refundAmountMinor, 999);
  assert.equal(transaction?.amountMinor, null);
});

test("RevenueCat trial purchase is not represented as a paid transaction", async () => {
  const runtime = await createApplication(revenueCatOptions(async () =>
    new Response(JSON.stringify(snapshot()), { status: 200 }),
  () => new Date("2026-09-24T00:00:00.000Z")));
  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/billing/webhooks/revenuecat",
    headers: { authorization: WEBHOOK_AUTH },
    body: webhookEvent({
      id: "evt_trial",
      type: "INITIAL_PURCHASE",
      period_type: "TRIAL",
      price_in_purchased_currency: 9.99,
      currency: "USD",
    }),
  });
  assert.equal(response.statusCode, 200);
  const [transaction] = await runtime.database.listAiNovelBillingTransactions("ai_novel", "user_alice");
  assert.equal(transaction?.status, "entitlement_active");
  assert.equal(transaction?.amountMinor, null);
});

test("RevenueCat webhook without provider timestamp does not create a synthetic transaction time", async () => {
  const snapshotWithoutTransaction = snapshot();
  delete (snapshotWithoutTransaction.subscriber.subscriptions.plus_monthly as Record<string, unknown>).store_transaction_id;
  const runtime = await createApplication(revenueCatOptions(async () =>
    new Response(JSON.stringify(snapshotWithoutTransaction), { status: 200 }),
  () => new Date("2026-09-24T00:00:00.000Z")));
  const body = webhookEvent({
    id: "evt_no_timestamp",
    type: "INITIAL_PURCHASE",
    price_in_purchased_currency: 9.99,
    currency: "USD",
  });
  delete body.event.event_timestamp_ms;
  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/billing/webhooks/revenuecat",
    headers: { authorization: WEBHOOK_AUTH },
    body,
  });
  assert.equal(response.statusCode, 200);
  const transactions = await runtime.database.listAiNovelBillingTransactions("ai_novel", "user_alice");
  assert.equal(transactions.length, 0);
});

test("RevenueCat voluntary cancellation is not recorded as a refund", async () => {
  const runtime = await createApplication(revenueCatOptions(async () =>
    new Response(JSON.stringify(snapshot()), { status: 200 }),
  () => new Date("2026-09-24T00:00:00.000Z")));
  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/billing/webhooks/revenuecat",
    headers: { authorization: WEBHOOK_AUTH },
    body: webhookEvent({
      id: "evt_unsubscribe",
      type: "CANCELLATION",
      cancel_reason: "UNSUBSCRIBE",
    }),
  });
  assert.equal(response.statusCode, 200);
  const [transaction] = await runtime.database.listAiNovelBillingTransactions("ai_novel", "user_alice");
  assert.equal(transaction?.status, "entitlement_active");
  assert.equal(transaction?.refundAmountMinor, null);
});

test("RevenueCat refund reversal restores paid status without a refund amount", async () => {
  const runtime = await createApplication(revenueCatOptions(async () =>
    new Response(JSON.stringify(snapshot()), { status: 200 }),
  () => new Date("2026-09-24T00:00:00.000Z")));
  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/billing/webhooks/revenuecat",
    headers: { authorization: WEBHOOK_AUTH },
    body: webhookEvent({
      id: "evt_refund_reversed",
      type: "REFUND_REVERSED",
      price_in_purchased_currency: 9.99,
      currency: "USD",
    }),
  });
  assert.equal(response.statusCode, 200);
  const [transaction] = await runtime.database.listAiNovelBillingTransactions("ai_novel", "user_alice");
  assert.equal(transaction?.status, "provider_paid");
  assert.equal(transaction?.amountMinor, 999);
  assert.equal(transaction?.refundAmountMinor, 0);
});

test("deleted account webhook events retain orders without restoring membership", async () => {
  let customerApiCalls = 0;
  const deletedAt = "2026-09-25T12:00:00.000Z";
  const runtime = await createApplication({
    ...revenueCatOptions(async () => {
      customerApiCalls++;
      return new Response(JSON.stringify(snapshot()), { status: 200 });
    }, () => new Date("2026-09-27T00:00:00.000Z")),
  });
  const receiveWebhook = (id: string, overrides: Record<string, unknown>) =>
    runtime.app.handle({
      method: "POST",
      path: "/api/v1/ai_novel/billing/webhooks/revenuecat",
      headers: { authorization: WEBHOOK_AUTH },
      body: webhookEvent({
        id,
        event_timestamp_ms: Date.parse("2026-09-24T10:00:00.000Z"),
        ...overrides,
      }),
    });

  const firstPurchase = await receiveWebhook("evt_before_delete", {});
  assert.equal(firstPurchase.body.data.status, "processed");
  assert.equal(customerApiCalls, 1);
  await runtime.database.withExclusiveSession(async () => {
    await runtime.database.deleteAppUserRuntimeData(
      "ai_novel",
      "user_alice",
      deletedAt,
    );
    await runtime.database.updateAppUserStatus(
      "ai_novel",
      "user_alice",
      "DELETED",
      deletedAt,
    );
  });

  const refund = await receiveWebhook("evt_after_delete_refund", {
    type: "CANCELLATION",
    cancel_reason: "CUSTOMER_SUPPORT",
    price_in_purchased_currency: -9.99,
    currency: "USD",
    event_timestamp_ms: Date.parse("2026-09-26T10:00:00.000Z"),
  });
  const renewal = await receiveWebhook("evt_after_delete_renewal", {
    type: "RENEWAL",
    transaction_id: "tx_plus_renewed_after_delete",
    purchased_at_ms: Date.parse("2026-09-26T10:00:00.000Z"),
    original_purchased_at_ms: Date.parse("2026-09-23T10:00:00.000Z"),
    expiration_at_ms: Date.parse("2026-10-26T10:00:00.000Z"),
    price_in_purchased_currency: 9.99,
    currency: "USD",
    event_timestamp_ms: Date.parse("2026-09-26T10:00:00.000Z"),
  });

  assert.equal(refund.body.data.status, "processed");
  assert.equal(renewal.body.data.status, "processed");
  assert.equal(customerApiCalls, 1, "deleted account webhook must not fetch a granting snapshot");
  const membership = await runtime.database.findAiNovelBillingMembership(
    "ai_novel",
    "user_alice",
  );
  assert.equal(membership?.active, false);
  assert.equal(membership?.state, "free");
  assert.equal(membership?.accountDeletedAt, deletedAt);
  const transactions = await runtime.database.listAiNovelBillingTransactions(
    "ai_novel",
    "user_alice",
  );
  assert.equal(transactions.length, 2);
  assert.equal(transactions.find((item) => item.status === "refunded")?.accountDeletedAt, deletedAt);
  assert.equal(transactions.find((item) => item.providerTransactionId === "tx_plus_renewed_after_delete")?.accountDeletedAt, deletedAt);
  assert.equal(
    (await runtime.database.findAiNovelBillingWebhookEvent("ai_novel", "evt_before_delete"))?.accountDeletedAt,
    deletedAt,
  );
  assert.equal(
    (await runtime.database.findAiNovelBillingWebhookEvent("ai_novel", "evt_after_delete_refund"))?.accountDeletedAt,
    deletedAt,
  );
});
