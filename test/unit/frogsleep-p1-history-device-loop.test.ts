import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

type Runtime = Awaited<ReturnType<typeof createApplication>>;
type Device = { token: string; userId: string };
type Query = Record<string, string>;

async function fixture() {
  const app = await createApplication({ frogsleepEnabled: true, queueBackend: "memory",
    databaseFactory: seed => new InMemoryDatabase(seed) });
  const aliceA = await login(app, "alice@example.com", "user_alice");
  const aliceB = await login(app, "alice@example.com", "user_alice");
  const bob = await login(app, "bob@example.com", "user_bob");
  return { app, aliceA, aliceB, bob };
}

async function login(app: Runtime, account: string, userId: string): Promise<Device> {
  const session = await app.services.authService.login({ appId: "frogsleep", account, password: "Password1234" });
  return { token: session.accessToken, userId };
}

function request(app: Runtime, device: Device, method: string, path: string, body?: unknown,
  headers: Record<string, string> = {}, query?: Query) {
  return app.app.handle({ method, path: `/api/v1/frogsleep${path}`, body, query,
    headers: { authorization: `Bearer ${device.token}`, ...headers }, requestId: "p1-history-device-loop" } as never);
}

async function ok(app: Runtime, device: Device, method: string, path: string, body?: unknown,
  headers: Record<string, string> = {}, query?: Query) {
  const result = await request(app, device, method, path, body, headers, query);
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  return result.body.data as any;
}

function rawSession(id: string, breaks = 0) {
  return { session_id: id, schema_version: "1", status: "completed",
    started_at: "2026-10-24T22:30:00+08:00", ended_at: "2026-10-25T06:30:00+08:00",
    scheduled_wake_at: "2026-10-25T07:00:00+08:00", sleep_intent: "night_sleep",
    timezone: "Asia/Shanghai", data: { break_count: breaks, accumulated_paused_seconds: 0 }, events: [] };
}

function writeHeaders(epoch: string, operation: string, revision?: number) {
  return { "x-sync-epoch": epoch, "idempotency-key": operation,
    ...(revision === undefined ? {} : { "if-match": String(revision) }) };
}

async function write(app: Runtime, device: Device, epoch: string, id: string, operation: string,
  revision?: number, breaks = 0) {
  return ok(app, device, revision === undefined ? "POST" : "PUT",
    `/product-data/sleep-sessions${revision === undefined ? "" : `/${id}`}`,
    rawSession(id, breaks), writeHeaders(epoch, operation, revision));
}

async function allPages(app: Runtime, device: Device, mode: string, first: any) {
  const items = [...first.items];
  let page = first;
  while (page.pagination.has_more) {
    assert.equal(typeof page.pagination.next_cursor, "string");
    page = await ok(app, device, "GET", `/product-data/personal-sync/${mode}`, undefined, {},
      { limit: "1", cursor: page.pagination.next_cursor });
    items.push(...page.items);
  }
  assert.equal(page.pagination.next_cursor, null);
  return { items, page };
}

test("two authenticated devices restore one fixed snapshot then apply paginated updates and tombstones", async () => {
  const { app, aliceA, aliceB } = await fixture();
  try {
    const state = await ok(app, aliceA, "GET", "/product-data/personal-sync/state");
    const firstWrite = await write(app, aliceA, state.sync_epoch, "night-1", "create-night-1");
    await write(app, aliceA, state.sync_epoch, "night-2", "create-night-2");
    const snapshot = await ok(app, aliceB, "GET", "/product-data/personal-sync/restore", undefined, {}, { limit: "1" });
    assert.equal(snapshot.pagination.has_more, true);
    await write(app, aliceA, state.sync_epoch, "night-1", "update-night-1", 1, 2);
    await ok(app, aliceA, "DELETE", "/product-data/sleep-sessions/night-2", undefined,
      writeHeaders(state.sync_epoch, "delete-night-2", 1));
    await write(app, aliceA, state.sync_epoch, "night-3", "create-night-3");
    const restored = await allPages(app, aliceB, "restore", snapshot);
    assert.deepEqual(restored.items.map((item: any) => item.id), ["night-1", "night-2"]);
    assert.ok(restored.items.every((item: any) => item.revision === 1 && !item.deleted));
    assert.equal(restored.items[0].data.data.break_count, 0);
    assert.equal(restored.items[0].data.started_at, "2026-10-24T14:30:00.000Z");
    const changes = await ok(app, aliceB, "GET", "/product-data/personal-sync/changes", undefined, {},
      { limit: "1", cursor: snapshot.changes_cursor });
    const applied = await allPages(app, aliceB, "changes", changes);
    assert.deepEqual(applied.items.map((item: any) => [item.id, item.revision, item.deleted]),
      [["night-1", 2, false], ["night-2", 2, true], ["night-3", 1, false]]);
    assert.equal(applied.items[0].data.data.break_count, 2);
    assert.deepEqual(applied.items[1].data, {});
    const idle = await ok(app, aliceB, "GET", "/product-data/personal-sync/changes", undefined, {},
      { cursor: applied.page.changes_cursor });
    assert.deepEqual(idle.items, []);
    assert.equal(firstWrite.sleep_session.revision, 1);
  } finally { await app.close(); }
});

test("device retries are idempotent and private account cursors cannot cross to another account", async () => {
  const { app, aliceA, aliceB, bob } = await fixture();
  try {
    const state = await ok(app, aliceA, "GET", "/product-data/personal-sync/state");
    const saved = await write(app, aliceA, state.sync_epoch, "shared-id", "fixed-operation");
    const replayed = await write(app, aliceB, state.sync_epoch, "shared-id", "fixed-operation");
    assert.deepEqual(replayed, saved);
    const alice = await ok(app, aliceB, "GET", "/product-data/personal-sync/restore");
    assert.equal(alice.items.length, 1);
    const stranger = await ok(app, bob, "GET", "/product-data/personal-sync/restore");
    assert.deepEqual(stranger.items, []);
    const stolen = await request(app, bob, "GET", "/product-data/personal-sync/changes", undefined, {},
      { cursor: alice.changes_cursor });
    assert.equal(stolen.statusCode, 409);
    assert.equal(stolen.body.code, "FROGSLEEP_SYNC_CURSOR_INVALID");
    assert.equal((await request(app, bob, "GET", "/product-data/sleep-sessions/shared-id")).statusCode, 404);
    const other = await ok(app, bob, "GET", "/product-data/personal-sync/state");
    await write(app, bob, other.sync_epoch, "shared-id", "fixed-operation", undefined, 3);
    const own = await ok(app, aliceB, "GET", "/product-data/sleep-sessions/shared-id");
    assert.equal(own.sleep_session.data.data.break_count, 0);
  } finally { await app.close(); }
});

test("account deletion rotates the recovery epoch and rejects stale cursors and stale device writes", async () => {
  const { app, aliceA, aliceB, bob } = await fixture();
  try {
    const before = await ok(app, aliceA, "GET", "/product-data/personal-sync/state");
    await write(app, aliceA, before.sync_epoch, "old-night", "old-upload");
    const snapshot = await ok(app, aliceB, "GET", "/product-data/personal-sync/restore");
    const other = await ok(app, bob, "GET", "/product-data/personal-sync/state");
    await write(app, bob, other.sync_epoch, "bob-night", "bob-upload");
    await ok(app, aliceA, "DELETE", "/me/account");
    assert.equal((await request(app, aliceB, "GET", "/product-data/personal-sync/state")).statusCode, 401);
    // Simulate subsequent account reprovisioning; every history operation still uses real authenticated routes.
    await app.database.updateAppUserStatus("frogsleep", aliceA.userId, "ACTIVE");
    const session = await app.services.authService.issueSession(aliceA.userId, "frogsleep");
    const restoredDevice = { ...aliceA, token: session.accessToken };
    const after = await ok(app, restoredDevice, "GET", "/product-data/personal-sync/state");
    assert.notEqual(after.sync_epoch, before.sync_epoch);
    assert.equal(after.sequence, 0);
    const stale = await request(app, restoredDevice, "POST", "/product-data/sleep-sessions", rawSession("old-night"),
      writeHeaders(before.sync_epoch, "old-upload"));
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.body.code, "FROGSLEEP_SYNC_EPOCH_MISMATCH");
    const cursor = await request(app, restoredDevice, "GET", "/product-data/personal-sync/changes", undefined, {},
      { cursor: snapshot.changes_cursor });
    assert.equal(cursor.statusCode, 409);
    assert.equal(cursor.body.code, "FROGSLEEP_SYNC_CURSOR_INVALID");
    assert.deepEqual((await ok(app, restoredDevice, "GET", "/product-data/personal-sync/restore")).items, []);
    await write(app, restoredDevice, after.sync_epoch, "new-night", "fresh-upload");
    assert.equal((await ok(app, bob, "GET", "/product-data/sleep-sessions/bob-night")).sleep_session.revision, 1);
  } finally { await app.close(); }
});
