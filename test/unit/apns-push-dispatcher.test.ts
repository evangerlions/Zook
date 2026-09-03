import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { ApnsPushDispatcher, ApnsRetryableError } from "../../src/services/apns-push-dispatcher.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

function base64UrlDecode(input: string): Buffer {
  const padded = input.padEnd(input.length + (4 - (input.length % 4)) % 4, "=");
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

test("APNs dispatcher signs ES256 JWTs with raw P1363 signatures", async () => {
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const privateKeyPem = privateKey.export({
    type: "pkcs8",
    format: "pem",
  }).toString();
  let authorizationHeader = "";
  let expirationHeader = "";

  const dispatcher = new ApnsPushDispatcher({
    teamId: "TEAM123456",
    keyId: "KEY1234567",
    bundleId: "com.example.frogsleep",
    privateKeyPem,
    production: false,
  }, {
    fetchImplementation: (async (_url, init) => {
      const headers = init?.headers as Record<string, string>;
      authorizationHeader = String(headers.authorization ?? "");
      expirationHeader = String(headers["apns-expiration"] ?? "");
      return new Response("", { status: 200 });
    }) as typeof fetch,
  });

  const beforeDispatch = Math.floor(Date.now() / 1000);
  await dispatcher.dispatch({
    appId: "frogsleep",
    userId: "user_alice",
    platform: "ios",
    pushToken: "device_token",
    payload: {
      app: "frogsleep",
      type: "focus_buddy_invite",
      title: "Focus invite",
      body: "Alice invited you.",
      data: {},
    },
  });

  const jwt = authorizationHeader.replace(/^bearer\s+/i, "");
  const signature = base64UrlDecode(jwt.split(".")[2] ?? "");
  assert.equal(signature.length, 64);

  const expiration = Number(expirationHeader);
  assert.ok(Number.isInteger(expiration));
  assert.ok(expiration >= beforeDispatch + 86_400);
  assert.ok(expiration <= Math.floor(Date.now() / 1000) + 86_400);
});

test("APNs dispatcher removes unrecoverable FrogSleep device tokens", async () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const database = new InMemoryDatabase(buildDefaultSeed(undefined, { includeFrogSleep: true }));
  const now = new Date().toISOString();
  database.upsertFrogSleepDevice({
    id: "device_bad_apns",
    appId: "frogsleep",
    userId: "user_alice",
    platform: "ios",
    pushToken: "bad_device_token",
    pushEnabled: true,
    createdAt: now,
    updatedAt: now,
  });

  const dispatcher = new ApnsPushDispatcher({
    teamId: "TEAM123456",
    keyId: "KEY1234567",
    bundleId: "com.example.frogsleep",
    privateKeyPem,
    production: false,
  }, {
    database,
    fetchImplementation: (async () => new Response(JSON.stringify({ reason: "BadDeviceToken" }), { status: 400 })) as typeof fetch,
  });

  await dispatcher.dispatch({
    appId: "frogsleep",
    userId: "user_alice",
    platform: "ios",
    pushToken: "bad_device_token",
    payload: {
      app: "frogsleep",
      type: "focus_buddy_invite",
      title: "Focus invite",
      body: "Alice invited you.",
      data: {},
    },
  });

  assert.equal(database.listFrogSleepDevices({ appId: "frogsleep", userId: "user_alice" }).length, 0);
  const deleted = database.listFrogSleepDevices({ appId: "frogsleep", userId: "user_alice", includeDeleted: true });
  assert.equal(deleted.length, 1);
  assert.equal(deleted[0].deletedAt !== undefined, true);
});

test("APNs dispatcher preserves retryable failures without removing devices", async () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const database = new InMemoryDatabase(buildDefaultSeed(undefined, { includeFrogSleep: true }));
  const now = new Date().toISOString();
  database.upsertFrogSleepDevice({
    id: "device_retry_apns",
    appId: "frogsleep",
    userId: "user_alice",
    platform: "ios",
    pushToken: "retry_device_token",
    pushEnabled: true,
    createdAt: now,
    updatedAt: now,
  });

  const dispatcher = new ApnsPushDispatcher({
    teamId: "TEAM123456",
    keyId: "KEY1234567",
    bundleId: "com.example.frogsleep",
    privateKeyPem,
    production: false,
  }, {
    database,
    fetchImplementation: (async () => new Response(JSON.stringify({ reason: "ServiceUnavailable" }), { status: 500 })) as typeof fetch,
  });

  await assert.rejects(
    dispatcher.dispatch({
      appId: "frogsleep",
      userId: "user_alice",
      platform: "ios",
      pushToken: "retry_device_token",
      payload: {
        app: "frogsleep",
        type: "focus_buddy_invite",
        title: "Focus invite",
        body: "Alice invited you.",
        data: {},
      },
    }),
    ApnsRetryableError,
  );

  assert.equal(database.listFrogSleepDevices({ appId: "frogsleep", userId: "user_alice" }).length, 1);
});

test("APNs dispatcher selects the LightTick topic and invokes product-scoped invalidation", async () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  let topic = ""; let payload: any; let invalidated = 0;
  const dispatcher = new ApnsPushDispatcher({ teamId: "TEAM123456", keyId: "KEY1234567",
    bundleId: "com.example.frogsleep", bundleIds: { lighttick: "com.lighttick.app" }, privateKeyPem, production: false }, {
    fetchImplementation: (async (_url, init) => {
      topic = String((init?.headers as Record<string, string>)["apns-topic"]);
      payload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ reason: "BadDeviceToken" }), { status: 400 });
    }) as typeof fetch,
  });
  await dispatcher.dispatch({ appId: "lighttick", userId: "user_lighttick", platform: "ios", pushToken: "invalid",
    payload: { app: "lighttick", type: "daily_tasks", title: "Today", body: "Open LightTick", data: { sync: "true" } },
    invalidateToken: async () => { invalidated++; } });

  assert.equal(topic, "com.lighttick.app");
  assert.equal(payload.aps.category, "LIGHTTICK_DAILY_TASKS");
  assert.equal(payload.sync, "true");
  assert.equal(invalidated, 1);
});
