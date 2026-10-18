import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

async function runtime() {
  return await createApplication({ frogsleepEnabled: true, queueBackend: "memory",
    databaseFactory: seed => new InMemoryDatabase(seed) });
}
type Runtime = Awaited<ReturnType<typeof runtime>>;
async function request(app: Runtime, method: string, path: string, token: string, body?: unknown) {
  const url = new URL(path, "https://fixture.invalid");
  return await app.app.handle({ method, path: `/api/v1/frogsleep/focus-buddy${url.pathname}`,
    query: Object.fromEntries(url.searchParams),
    headers: { authorization: `Bearer ${token}` }, body, requestId: `focus-idempotency-${method}` } as never);
}
async function login(app: Runtime, account = "alice@example.com") {
  const response = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/auth/password/login",
    headers: {}, body: { account, password: "Password1234" }, requestId: "focus-idempotency-login" } as never);
  assert.equal(response.statusCode, 200);
  return response.body.data.access_token as string;
}
function payload(sessionId: string | undefined = "stable-focus", minutes = 25) {
  return { session_id: sessionId, goal_tag: "study", planned_minutes: 25, actual_minutes: minutes,
    status: "completed", started_at: "2026-10-10T10:00:00Z", ended_at: "2026-10-10T10:25:00Z" };
}
async function assertStats(app: Runtime, token: string, count: number, minutes: number) {
  const list = await request(app, "GET", "/sessions", token);
  const stats = await request(app, "GET", "/stats/week?week_start=2026-10-05", token);
  assert.equal(list.statusCode, 200); assert.equal(stats.statusCode, 200);
  assert.equal(list.body.data.sessions.length, count);
  assert.equal(stats.body.data.session_count, count);
  assert.equal(stats.body.data.total_minutes, minutes);
  assert.equal(stats.body.data.completed_count, count);
  assert.equal(stats.body.data.daily.reduce((sum: number, day: { session_count: number }) => sum + day.session_count, 0), count);
}

test("focus replay returns the same server record and never doubles weekly/daily statistics", async () => {
  const app = await runtime(); const token = await login(app);
  const first = await request(app, "POST", "/sessions", token, payload());
  for (let i = 0; i < 4; i++) {
    const replay = await request(app, "POST", "/sessions", token, payload());
    assert.equal(replay.statusCode, 200);
    assert.deepEqual(replay.body.data, first.body.data);
  }
  await assertStats(app, token, 1, 25);
  assert.equal(app.database.listFrogSleepEntities({ appId: "frogsleep", kind: "focus_milestone", ownerUserId: "user_alice" }).length, 1);
});

test("concurrent focus replays produce a single entity and a single first-session milestone", async () => {
  const app = await runtime(); const token = await login(app);
  const responses = await Promise.all(Array.from({ length: 24 }, () => request(app, "POST", "/sessions", token, payload())));
  assert.ok(responses.every(response => response.statusCode === 200));
  assert.equal(new Set(responses.map(response => response.body.data.session_id)).size, 1);
  await assertStats(app, token, 1, 25);
  assert.equal(app.database.listFrogSleepEntities({ appId: "frogsleep", kind: "focus_milestone", ownerUserId: "user_alice" }).length, 1);
});

test("same client session ID remains independent across authenticated accounts", async () => {
  const app = await runtime(); const alice = await login(app); const bob = await login(app, "bob@example.com");
  const a = await request(app, "POST", "/sessions", alice, { ...payload(), owner_user_id: "user_bob", app_id: "ai_novel" });
  const b = await request(app, "POST", "/sessions", bob, { ...payload(undefined, 40), session_id: "stable-focus", owner_user_id: "user_alice" });
  assert.equal(a.statusCode, 403);
  assert.equal(b.statusCode, 403);
  await request(app, "POST", "/sessions", alice, payload());
  await request(app, "POST", "/sessions", bob, { ...payload(), actual_minutes: 40 });
  await assertStats(app, alice, 1, 25); await assertStats(app, bob, 1, 40);
});

test("same-key correction updates one record and preserves ID/created time", async () => {
  const app = await runtime(); const token = await login(app);
  const first = await request(app, "POST", "/sessions", token, payload());
  const correction = await request(app, "POST", "/sessions", token, payload("stable-focus", 35));
  assert.equal(correction.statusCode, 200);
  assert.equal(correction.body.data.session_id, first.body.data.session_id);
  assert.equal(correction.body.data.created_at, first.body.data.created_at);
  await request(app, "POST", "/sessions", token, payload("stable-focus", 35));
  await assertStats(app, token, 1, 35);
});

test("camelCase ID and equivalent timestamp aliases share the replay identity", async () => {
  const app = await runtime(); const token = await login(app);
  const first = await request(app, "POST", "/sessions", token, payload());
  const replay = await request(app, "POST", "/sessions", token, { sessionId: "stable-focus", goalTag: "study",
    plannedMinutes: 25, actualMinutes: 25, status: "completed", startedAt: "2026-10-10T10:00:00.000Z", endedAt: "2026-10-10T10:25:00.000Z" });
  assert.deepEqual(replay.body.data, first.body.data);
  await assertStats(app, token, 1, 25);
});

test("invalid or conflicting IDs fail before creating history", async () => {
  const app = await runtime(); const token = await login(app);
  for (const id of [null, "", "   ", 123, {}, "x".repeat(129)]) {
    const result = await request(app, "POST", "/sessions", token, { ...payload(), session_id: id });
    assert.equal(result.statusCode, 400);
    assert.equal(result.body.code, "REQ_INVALID_BODY");
  }
  const conflicting = await request(app, "POST", "/sessions", token, { ...payload(), sessionId: "different" });
  assert.equal(conflicting.statusCode, 400);
  assert.equal(conflicting.body.code, "REQ_INVALID_BODY");
  await assertStats(app, token, 0, 0);
});

test("omitted client ID retains append-only legacy behavior", async () => {
  const app = await runtime(); const token = await login(app);
  const body = payload(); delete (body as { session_id?: string }).session_id;
  const first = await request(app, "POST", "/sessions", token, body);
  const second = await request(app, "POST", "/sessions", token, body);
  assert.notEqual(first.body.data.session_id, second.body.data.session_id);
  await assertStats(app, token, 2, 50);
});

test("replay without explicit timestamps keeps the first server defaults", async () => {
  const app = await runtime(); const token = await login(app);
  const body = { session_id: "default-times", actual_minutes: 10, status: "completed" };
  const first = await request(app, "POST", "/sessions", token, body);
  await new Promise(resolve => setTimeout(resolve, 20));
  const replay = await request(app, "POST", "/sessions", token, body);
  assert.deepEqual(replay.body.data, first.body.data);
});


test("opaque IDs preserve case and whitespace and do not collapse distinct sessions", async () => {
  const app = await runtime(); const token = await login(app);
  for (const id of ["Opaque-FOCUS", "opaque-focus", " Opaque-FOCUS "]) {
    const first = await request(app, "POST", "/sessions", token, payload(id));
    const replay = await request(app, "POST", "/sessions", token, payload(id));
    assert.deepEqual(replay.body.data, first.body.data);
    assert.equal(replay.body.data.id, id);
  }
  await assertStats(app, token, 3, 75);
});

test("replaying personal focus does not recreate derived shared moments", async () => {
  const app = await runtime(); const alice = await login(app); const bob = await login(app, "bob@example.com");
  const now = new Date().toISOString();
  app.database.insertFrogSleepEntity({ id: "idempotency-relationship", kind: "focus_relationship", appId: "frogsleep",
    ownerUserId: "user_alice", partnerUserId: "user_bob", status: "accepted", payload: {}, createdAt: now, updatedAt: now });
  await request(app, "POST", "/sessions", bob, payload("bob-focus"));
  const initial = await request(app, "POST", "/sessions", alice, payload("alice-focus"));
  const responses = await Promise.all(Array.from({ length: 10 }, () => request(app, "POST", "/sessions", alice, payload("alice-focus"))));
  assert.ok(responses.every(response => response.body.data.session_id === initial.body.data.session_id));
  assert.equal(app.database.listFrogSleepEntities({ appId: "frogsleep", kind: "focus_shared_moment" }).length, 1);
  await assertStats(app, alice, 1, 25); await assertStats(app, bob, 1, 25);
});
