import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { enableFrogSleepBuddyCapabilities } from "../helpers/enable-frogsleep-buddy-capabilities.ts";

enableFrogSleepBuddyCapabilities();
type Runtime = Awaited<ReturnType<typeof createApplication>>;
type Fixture = { app: Runtime; alice: string; bob: string; relationshipId: string };

async function request(f: Fixture, token: string, method: string, path: string, body?: unknown) {
  return await f.app.app.handle({ method, path: `/api/v1/frogsleep${path}`, body,
    headers: { authorization: `Bearer ${token}` }, requestId: "completion_boundaries" } as never);
}

async function fixture(): Promise<Fixture> {
  const app = await createApplication({ frogsleepEnabled: true, queueBackend: "memory",
    databaseFactory: seed => new InMemoryDatabase(seed) });
  const now = new Date().toISOString(), relationshipId = "boundary_focus";
  await app.database.insertFrogSleepEntity({ id: relationshipId, appId: "frogsleep", kind: "focus_relationship",
    ownerUserId: "user_alice", partnerUserId: "user_bob", status: "accepted", payload: {}, createdAt: now, updatedAt: now });
  for (const id of ["user_alice", "user_bob"]) await app.services.appRegistryService.ensureMembership("frogsleep", id);
  const f = { app, alice: "", bob: "", relationshipId };
  await renew(f);
  return f;
}

async function renew(f: Fixture) {
  f.alice = (await f.app.services.authService.issueSession("user_alice", "frogsleep")).accessToken;
  f.bob = (await f.app.services.authService.issueSession("user_bob", "frogsleep")).accessToken;
}

async function activeGoal(f: Fixture, target = 25) {
  const created = await request(f, f.alice, "POST", "/buddy/goals", {
    relationship_id: f.relationshipId, type: "focus_minutes", target, timezone: "UTC", idempotency_key: "boundary_goal" });
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const accepted = await request(f, f.bob, "POST", `/buddy/goals/${created.body.data.id}/accept`, {
    expected_version: 1, idempotency_key: "accept_goal" });
  assert.equal(accepted.statusCode, 200, JSON.stringify(accepted.body));
  return accepted.body.data;
}

async function upload(f: Fixture, token: string, id: string, startedAt: string, endedAt: string) {
  const result = await request(f, token, "POST", "/focus-buddy/sessions", {
    session_id: id, status: "completed", started_at: startedAt, ended_at: endedAt,
    actual_minutes: 25, planned_minutes: 25, room: "reading", goal: "25m" });
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
}

async function readGoal(f: Fixture, id: string) {
  const result = await request(f, f.alice, "GET", "/buddy/goals");
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  return result.body.data.goals.find((item: any) => item.id === id);
}

test("historical uploads from before bilateral acceptance cannot complete the new goal", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-12T12:00:00Z") });
  const f = await fixture(), goal = await activeGoal(f);
  for (const [token, id] of [[f.alice, "old_alice"], [f.bob, "old_bob"]]) {
    await upload(f, token, id, "2026-10-12T11:00:00.000Z", "2026-10-12T11:25:00.000Z");
  }
  const actual = await readGoal(f, goal.id);
  assert.deepEqual(actual.participant_progress, { user_alice: 0, user_bob: 0 });
  assert.equal(actual.status, "active");
});

test("goal pause freezes progress before later completed sessions", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-12T12:00:00Z") });
  const f = await fixture(), goal = await activeGoal(f, 100);
  const start = new Date().toISOString();
  context.mock.timers.tick(25 * 60_000);
  await renew(f);
  await upload(f, f.alice, "before_pause", start, new Date().toISOString());
  context.mock.timers.tick(1);
  const paused = await request(f, f.alice, "POST", `/buddy/goals/${goal.id}/pause`, {
    expected_version: goal.version, idempotency_key: "pause" });
  assert.equal(paused.statusCode, 200, JSON.stringify(paused.body));
  const afterPause = new Date().toISOString();
  context.mock.timers.tick(25 * 60_000);
  await renew(f);
  await upload(f, f.alice, "after_pause", afterPause, new Date().toISOString());
  const actual = await readGoal(f, goal.id);
  assert.deepEqual(actual.participant_progress, { user_alice: 25, user_bob: 0 });
  assert.equal(actual.status, "paused");
});

test("a paused goal cannot be manually completed even when delayed sources prove both targets", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-12T12:00:00Z") });
  const f = await fixture(), goal = await activeGoal(f);
  const startedAt = new Date().toISOString();
  context.mock.timers.tick(25 * 60_000);
  await renew(f);
  const endedAt = new Date().toISOString();
  await upload(f, f.alice, "alice_before_pause", startedAt, endedAt);
  context.mock.timers.tick(1);
  const paused = await request(f, f.alice, "POST", `/buddy/goals/${goal.id}/pause`, {
    expected_version: goal.version, idempotency_key: "pause_before_delayed_upload" });
  assert.equal(paused.statusCode, 200, JSON.stringify(paused.body));
  await upload(f, f.bob, "bob_delayed_before_pause", startedAt, endedAt);
  const actual = await readGoal(f, goal.id);
  assert.deepEqual(actual.participant_progress, { user_alice: 25, user_bob: 25 });
  assert.equal(actual.status, "paused");
  const completed = await request(f, f.bob, "POST", `/buddy/goals/${goal.id}/complete`, {
    expected_version: actual.version, idempotency_key: "cannot_complete_paused" });
  assert.equal(completed.statusCode, 409);
});
