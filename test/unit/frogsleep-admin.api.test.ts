import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

async function fixture() {
  const runtime = await createApplication({ frogsleepEnabled: true, queueBackend: "memory", adminBasicAuth: { username: "sleep-admin", password: "fixture-password" }, databaseFactory: seed => new InMemoryDatabase(seed) });
  const call = (method: string, path: string, body?: unknown, cookie?: string, query?: Record<string,string>) => runtime.app.handle({ method, path, body, headers: {}, cookies: cookie ? { adminSession: cookie } : {}, query, requestId: "admin-sleep-test" } as never);
  const login = await call("POST", "/api/v1/admin/auth/login", { username: "sleep-admin", password: "fixture-password" });
  assert.equal(login.statusCode, 200);
  const cookie = decodeURIComponent(login.headers!["Set-Cookie"].match(/adminSession=([^;]+)/)![1]);
  const admin = (method: string, path: string, body?: unknown, query?: Record<string,string>) => call(method, `/api/v1/admin/apps/frogsleep${path}`, body, cookie, query);
  const authorize = async (operation: string) => {
    const requested = await call("POST", "/api/v1/admin/sensitive-operations/request-code", { operation }, cookie);
    assert.equal(requested.statusCode, 200);
    const grant = await call("POST", "/api/v1/admin/sensitive-operations/verify", { operation, code: "199510" }, cookie);
    assert.equal(grant.statusCode, 200);
  };
  return { runtime, call, admin, authorize };
}

test("Sleep admin requires a session and aggregates never expose private data", async () => {
  const f = await fixture();
  assert.equal((await f.call("GET", "/api/v1/admin/apps/frogsleep/operations")).statusCode, 401);
  const basic = await f.runtime.app.handle({ method: "GET", path: "/api/v1/admin/apps/frogsleep/operations", headers: { authorization: `Basic ${Buffer.from("sleep-admin:fixture-password").toString("base64")}` } } as never);
  assert.equal(basic.statusCode, 401);
  const result = await f.admin("GET", "/operations"); assert.equal(result.statusCode, 200);
  assert.equal(result.body.data.app_id, "frogsleep"); assert.equal(result.body.data.privacy.aggregates_only, true);
  assert.equal(f.runtime.database.auditLogs.find(r => r.action === "frogsleep.operations.read")?.actorUserId, "sleep-admin");
  assert.equal((await f.admin("GET", "/records/accounts")).statusCode, 403);
});

test("authorized metadata supports pagination and filters without payload or device secrets", async () => {
  const f = await fixture(); await f.authorize("frogsleep.records.read");
  const now = new Date().toISOString();
  for (let i=0;i<57;i++) await f.runtime.database.upsertFrogSleepDevice({ id: `admin_device_${i}`, appId: "frogsleep", userId: "user_alice", platform: "ios", pushToken: `PRIVATE_TOKEN_${i}`, pushEnabled: true, createdAt: now, updatedAt: now });
  await f.runtime.database.upsertFrogSleepDevice({ id: "other_app", appId: "ai_novel", userId: "user_alice", platform: "ios", pushToken: "PRIVATE_OTHER", pushEnabled: true, createdAt: now, updatedAt: now });
  const page = await f.admin("GET", "/records/devices", undefined, { page: "2", limit: "25", user_id: "user_alice", status: "enabled" });
  assert.equal(page.statusCode, 200); assert.equal(page.body.data.total, 57); assert.equal(page.body.data.items.length, 25);
  assert.ok(!JSON.stringify(page.body.data).includes("PRIVATE"));
  assert.equal(f.runtime.database.auditLogs.find(r => r.action === "frogsleep.devices.read")?.payload.privacy, "metadata_only");
  assert.equal((await f.admin("GET", "/records/devices", undefined, { page: "1.2" })).statusCode, 400);
  assert.equal((await f.admin("GET", "/records/anything")).statusCode, 400);
  assert.equal((await f.admin("GET", "/records/devices", undefined, { limit: "101" })).statusCode, 400);
});

test("admin retry is authorized, audited, concurrent idempotent and preserves original attempts", async () => {
  const f = await fixture(); const db = f.runtime.database;
  await db.insertNotificationJob({ id: "sleep_failed", appId: "frogsleep", recipientUserId: "user_alice", channel: "push", status: "FAILED", retryCount: 2, payload: { _frogsleep_delivery: { devices: { accepted: "provider_accepted" } } } });
  assert.equal((await f.admin("POST", "/notifications/sleep_failed/retry", { reason: "test" })).statusCode, 403);
  await f.authorize("frogsleep.notifications.retry");
  assert.equal((await f.admin("POST", "/notifications/sleep_failed/retry", {})).statusCode, 400);
  const results = await Promise.all(Array.from({length:8}, () => f.admin("POST", "/notifications/sleep_failed/retry", { reason: "Recover provider outage" })));
  assert.ok(results.every(r => r.statusCode === 200));
  assert.equal((await db.findNotificationJob("sleep_failed"))!.retryCount, 2);
  assert.equal((await db.findNotificationJob("sleep_failed"))!.status, "QUEUED");
  assert.equal(db.notificationJobs.length, 1);
  const audits = db.auditLogs.filter(r => r.action === "frogsleep.notifications.retry");
  assert.equal(audits.length, 1); assert.equal(audits[0].actorUserId, "sleep-admin");
  assert.equal(audits[0].resourceId, "sleep_failed");
});

test("admin cannot retry another app, terminal, unknown or budget exhausted jobs", async () => {
  const f = await fixture(); await f.authorize("frogsleep.notifications.retry");
  const rows = [
    { id: "other", appId: "ai_novel", status: "FAILED", retryCount: 0, payload: {} },
    { id: "terminal", appId: "frogsleep", status: "SENT", retryCount: 1, payload: {} },
    { id: "exhausted", appId: "frogsleep", status: "FAILED", retryCount: 5, payload: {} },
    { id: "unknown", appId: "frogsleep", status: "FAILED", retryCount: 1, payload: { _frogsleep_delivery: { devices: { device: "outcome_unknown" } } } },
    { id: "processing", appId: "frogsleep", status: "FAILED", retryCount: 1, payload: { _frogsleep_delivery: { devices: { device: "processing" } } } },
  ];
  for (const r of rows) { await f.runtime.database.insertNotificationJob({ ...r, recipientUserId: "user_alice", channel: "push" } as never);
    assert.equal((await f.admin("POST", `/notifications/${r.id}/retry`, { reason: "test" })).statusCode, r.id === "other" ? 404 : 409); }
});
