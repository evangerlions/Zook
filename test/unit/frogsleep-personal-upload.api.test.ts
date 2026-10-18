import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

async function fixture() {
  const runtime = await createApplication({ frogsleepEnabled: true, queueBackend: "memory",
    databaseFactory: seed => new InMemoryDatabase(seed) });
  async function login(account: string) {
    const response = await runtime.app.handle({ method: "POST",
      path: "/api/v1/frogsleep/auth/password/login", headers: {},
      body: { account, password: "Password1234" } } as never);
    assert.equal(response.statusCode, 200);
    return String(response.body.data.access_token);
  }
  const alice = await login("alice@example.com");
  const bob = await login("bob@example.com");
  async function upload(path: string, token: string, body: Record<string, unknown>) {
    return await runtime.app.handle({ method: "POST", path: `/api/v1/frogsleep/${path}`,
      headers: { authorization: `Bearer ${token}` }, body } as never);
  }
  return { runtime, alice, bob, upload };
}

const focus = { session_id: "guest-focus-1", started_at: "2026-10-15T23:50:00Z",
  ended_at: "2026-10-16T00:10:00Z", planned_minutes: 20, actual_minutes: 20,
  status: "completed", room_id: "library" };
const report = { snapshot_id: "guest-report-1", schema_version: "1",
  recorded_at: "2026-10-16T00:00:00Z", date_anchor: "2026-10-16",
  data: { sleep_minutes: 420, quality: "rested" } };

for (const [path, kind, body] of [
  ["focus/sessions", "focus_session", focus],
  ["product-data/sleep-reports", "sleep_report_snapshot", report],
] as const) {
  test(`${kind}: concurrent retries store one record and preserve server ID`, async () => {
    const { runtime, alice, upload } = await fixture();
    const results = await Promise.all(Array.from({ length: 6 }, () => upload(path, alice, body)));
    assert.deepEqual(results.map(result => result.statusCode), Array(6).fill(200));
    assert.equal(new Set(results.map(result => result.body.data.id)).size, 1);
    assert.equal(runtime.database.listFrogSleepEntities({ appId: "frogsleep", kind,
      ownerUserId: "user_alice" }).length, 1);
  });

  test(`${kind}: owner is authenticated, matching client IDs in different accounts remain separate`, async () => {
    const { runtime, alice, bob, upload } = await fixture();
    assert.equal((await upload(path, alice, { ...body, owner_user_id: "user_bob" })).statusCode, 403);
    const first = await upload(path, alice, body);
    const second = await upload(path, bob, body);
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(runtime.database.listFrogSleepEntities({ appId: "frogsleep", kind }).length, 2);
  });

  test(`${kind}: changed terminal payload conflicts without overwriting accepted data`, async () => {
    const { alice, upload } = await fixture();
    const first = await upload(path, alice, body);
    const changed = kind === "focus_session" ? { ...body, actual_minutes: 19 }
      : { ...body, data: { sleep_minutes: 123 } };
    assert.equal((await upload(path, alice, changed)).statusCode, 409);
    const replay = await upload(path, alice, body);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body.data.id, first.body.data.id);
  });
}

test("binding metadata requires its authenticated owner and excludes unfinished focus sessions", async () => {
  const { alice, upload } = await fixture();
  const binding = { owner_user_id: "user_alice", job_id: "binding-1",
    confirmed_at: "2026-10-16T08:00:00Z" };
  assert.equal((await upload("focus/sessions", alice,
    { ...focus, status: "focusing", binding })).statusCode, 400);
  assert.equal((await upload("focus/sessions", alice,
    { ...focus, binding: { ...binding, owner_user_id: "user_bob" } })).statusCode, 403);
  assert.equal((await upload("focus/sessions", alice, { ...focus, binding })).statusCode, 200);
  assert.equal((await upload("focus/sessions", alice,
    { ...focus, binding: { ...binding, job_id: "binding-2" } })).statusCode, 200);
});

test("legacy terminal calls with stable IDs and omitted timestamps replay their original server defaults", async () => {
  const { runtime, alice, upload } = await fixture();
  const body = { session_id: "legacy-default-time", minutes: 25 };
  const responses = await Promise.all(Array.from({ length: 5 }, () => upload("focus/sessions", alice, body)));
  assert.deepEqual(responses.map(item => item.statusCode), Array(5).fill(200));
  assert.equal(new Set(responses.map(item => item.body.data.started_at)).size, 1);
  assert.equal(runtime.database.listFrogSleepEntities({ appId: "frogsleep", kind: "focus_session" }).length, 1);
});
