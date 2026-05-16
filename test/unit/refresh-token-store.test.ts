import assert from "node:assert/strict";
import test from "node:test";
import { KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
import { RefreshTokenStore } from "../../src/services/refresh-token-store.ts";
import type { RefreshTokenRecord } from "../../src/shared/types.ts";

async function createStore() {
  const kvManager = await KVManager.create({ kvBackend: new (await import("../../src/infrastructure/kv/kv-manager.ts")).InMemoryKVBackend() });
  return { store: new RefreshTokenStore(kvManager), kvManager };
}

function makeRecord(overrides: Partial<RefreshTokenRecord> = {}): RefreshTokenRecord {
  return {
    id: overrides.id ?? "rft_1",
    appId: overrides.appId ?? "app_a",
    userId: overrides.userId ?? "user_1",
    tokenHash: overrides.tokenHash ?? "hash_abc",
    expiresAt: overrides.expiresAt ?? "2026-05-01T00:00:00.000Z",
    revokedAt: overrides.revokedAt,
    replacedBy: overrides.replacedBy,
  };
}

// --- Create and retrieve ---

test("RefreshTokenStore creates and retrieves a token record by hash", async () => {
  const { store } = await createStore();
  const record = makeRecord();
  await store.create(record);

  const found = await store.getByTokenHash("hash_abc");
  assert.ok(found);
  assert.equal(found.id, "rft_1");
  assert.equal(found.appId, "app_a");
  assert.equal(found.userId, "user_1");
});

test("RefreshTokenStore returns undefined for unknown token hash", async () => {
  const { store } = await createStore();
  const found = await store.getByTokenHash("nonexistent");
  assert.equal(found, undefined);
});

// --- Update ---

test("RefreshTokenStore update modifies the record", async () => {
  const { store } = await createStore();
  const record = makeRecord();
  await store.create(record);

  record.revokedAt = "2026-04-13T00:00:00.000Z";
  await store.update(record);

  const found = await store.getByTokenHash("hash_abc");
  assert.ok(found);
  assert.equal(found.revokedAt, "2026-04-13T00:00:00.000Z");
});

// --- Revoke all ---

test("RefreshTokenStore revokes all tokens for a user-app pair", async () => {
  const { store } = await createStore();
  await store.create(makeRecord({ id: "rft_1", tokenHash: "hash_1" }));
  await store.create(makeRecord({ id: "rft_2", tokenHash: "hash_2" }));

  const revoked = await store.revokeAllByUserAndApp("app_a", "user_1", "2026-04-13T00:00:00.000Z");
  assert.equal(revoked, 2);

  const tokens = await store.listByUserAndApp("app_a", "user_1");
  assert.equal(tokens.length, 2);
  assert.ok(tokens.every(t => t.revokedAt === "2026-04-13T00:00:00.000Z"));
});

test("RefreshTokenStore revokeAll skips already-revoked tokens", async () => {
  const { store } = await createStore();
  await store.create(makeRecord({ id: "rft_1", tokenHash: "hash_1", revokedAt: "2026-04-01T00:00:00.000Z" }));
  await store.create(makeRecord({ id: "rft_2", tokenHash: "hash_2" }));

  const revoked = await store.revokeAllByUserAndApp("app_a", "user_1", "2026-04-13T00:00:00.000Z");
  assert.equal(revoked, 1);
});

// --- List by user and app ---

test("RefreshTokenStore lists tokens by user and app", async () => {
  const { store } = await createStore();
  await store.create(makeRecord({ id: "rft_1", appId: "app_a", userId: "user_1", tokenHash: "hash_1" }));
  await store.create(makeRecord({ id: "rft_2", appId: "app_a", userId: "user_1", tokenHash: "hash_2" }));
  await store.create(makeRecord({ id: "rft_3", appId: "app_b", userId: "user_1", tokenHash: "hash_3" }));

  const appATokens = await store.listByUserAndApp("app_a", "user_1");
  assert.equal(appATokens.length, 2);

  const appBTokens = await store.listByUserAndApp("app_b", "user_1");
  assert.equal(appBTokens.length, 1);
});

// --- Delete by app ---

test("RefreshTokenStore deleteByApp removes all tokens for an app", async () => {
  const { store } = await createStore();
  await store.create(makeRecord({ id: "rft_1", appId: "app_a", userId: "user_1", tokenHash: "hash_1" }));
  await store.create(makeRecord({ id: "rft_2", appId: "app_a", userId: "user_2", tokenHash: "hash_2" }));
  await store.create(makeRecord({ id: "rft_3", appId: "app_b", userId: "user_1", tokenHash: "hash_3" }));

  await store.deleteByApp("app_a");

  const appATokens = await store.listByUserAndApp("app_a", "user_1");
  assert.equal(appATokens.length, 0);

  // app_b tokens should still exist
  const appBTokens = await store.listByUserAndApp("app_b", "user_1");
  assert.equal(appBTokens.length, 1);

  // Direct hash lookup for deleted tokens should be undefined
  assert.equal(await store.getByTokenHash("hash_1"), undefined);
  assert.equal(await store.getByTokenHash("hash_2"), undefined);
});
