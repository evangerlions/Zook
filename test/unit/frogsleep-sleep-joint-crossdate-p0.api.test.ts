import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { enableFrogSleepBuddyCapabilities } from "../helpers/enable-frogsleep-buddy-capabilities.ts";

enableFrogSleepBuddyCapabilities();
type Runtime = Awaited<ReturnType<typeof createApplication>>;
type Actor = { id: string; email: string; token: string };
type Fixture = { app: Runtime; alice: Actor; bob: Actor; relationshipId: string; activityId: string; goalId: string };

async function request(app: Runtime, actor: Actor | null, method: string, path: string, body?: unknown) {
  return await app.app.handle({ method, path: `/api/v1/frogsleep${path}`, body,
    headers: actor ? { authorization: `Bearer ${actor.token}` } : {}, requestId: "sleep_joint_crossdate_p0" } as never);
}

async function login(app: Runtime, id: string, email: string): Promise<Actor> {
  const result = await request(app, null, "POST", "/auth/password/login", { account: email, password: "Password1234" });
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  return { id, email, token: String(result.body.data.access_token) };
}

async function fixture(target = 1): Promise<Fixture> {
  const app = await createApplication({ frogsleepEnabled: true, queueBackend: "memory",
    databaseFactory: seed => new InMemoryDatabase(seed) });
  const alice = await login(app, "user_alice", "alice@example.com");
  const bob = await login(app, "user_bob", "bob@example.com");
  const relationshipId = await acceptedRelationship(app, alice, bob);
  for (const actor of [alice, bob]) await authorize(app, actor, relationshipId);
  const goalId = await activeGoal(app, alice, bob, relationshipId, target);
  const activityId = await startedActivity(app, alice, bob, relationshipId);
  return { app, alice, bob, relationshipId, activityId, goalId };
}

async function acceptedRelationship(app: Runtime, alice: Actor, bob: Actor) {
  const invitation = await request(app, alice, "POST", "/buddy/invitations", {
    target: { email: bob.email }, domains: ["sleep"] });
  assert.equal(invitation.statusCode, 200, JSON.stringify(invitation.body));
  const accepted = await request(app, bob, "POST", `/buddy/invitations/${invitation.body.data.invitation_id}/domains/sleep/accept`,
    { expected_version: 1, idempotency_key: "crossdate_relationship_accept" });
  assert.equal(accepted.statusCode, 200, JSON.stringify(accepted.body));
  return String(accepted.body.data.relationship_id);
}

async function authorize(app: Runtime, actor: Actor, relationshipId: string) {
  const listed = await request(app, actor, "GET", `/buddy/relationships/${relationshipId}/grants`);
  assert.equal(listed.statusCode, 200, JSON.stringify(listed.body));
  const grants = listed.body.data.grants.filter((grant: any) => grant.grantor_user_id === actor.id && grant.state !== "granted");
  for (const grant of grants) {
    const updated = await request(app, actor, "PATCH", `/buddy/relationships/${relationshipId}/grants/${grant.id}`,
      { expected_version: grant.version, state: "granted" });
    assert.equal(updated.statusCode, 200, JSON.stringify(updated.body));
  }
}

async function activeGoal(app: Runtime, alice: Actor, bob: Actor, relationshipId: string, target: number) {
  const created = await request(app, alice, "POST", "/buddy/goals", { relationship_id: relationshipId,
    type: "sleep_schedule_days", target, timezone: "UTC", idempotency_key: "crossdate_goal" });
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const accepted = await request(app, bob, "POST", `/buddy/goals/${created.body.data.id}/accept`, {
    expected_version: 1, idempotency_key: "crossdate_goal_accept" });
  assert.equal(accepted.statusCode, 200, JSON.stringify(accepted.body));
  return String(created.body.data.id);
}

async function startedActivity(app: Runtime, alice: Actor, bob: Actor, relationshipId: string) {
  const created = await request(app, alice, "POST", "/buddy/joint-activities", {
    relationship_id: relationshipId, type: "tonight_together", idempotency_key: "crossdate_activity" });
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const path = `/buddy/joint-activities/${created.body.data.id}`;
  assert.equal((await request(app, bob, "POST", `${path}/accept`)).statusCode, 200);
  for (const actor of [alice, bob]) assert.equal((await request(app, actor, "POST", `${path}/start`)).statusCode, 200);
  return String(created.body.data.id);
}

async function begin(f: Fixture, actor: Actor, dateAnchor: string) {
  const result = await request(f.app, actor, "POST", "/sleep-buddy/shared-sessions", {
    relationship_id: f.relationshipId, date_anchor: dateAnchor, joint_activity_id: f.activityId });
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  return result.body.data;
}

async function accept(f: Fixture, actor: Actor, sessionId: string) {
  const result = await request(f.app, actor, "POST", `/sleep-buddy/shared-sessions/${sessionId}/accept`);
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
}

async function morningTwice(f: Fixture, actor: Actor, sessionId: string, occurredAt: string) {
  for (let retry = 0; retry < 2; retry += 1) {
    const result = await request(f.app, actor, "POST", `/sleep-buddy/shared-sessions/${sessionId}/events`, {
      event_type: "morning_completed", occurred_at: occurredAt });
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  }
}

async function renew(f: Fixture) {
  f.alice = await login(f.app, f.alice.id, f.alice.email);
  f.bob = await login(f.app, f.bob.id, f.bob.email);
}

async function assertGoal(f: Fixture, alice: number, bob: number, status: string) {
  for (const viewer of [f.alice, f.bob]) {
    const result = await request(f.app, viewer, "GET", "/buddy/goals");
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    const goal = result.body.data.goals.find((item: any) => item.id === f.goalId);
    assert.ok(goal);
    assert.deepEqual(goal.participant_progress, { [f.alice.id]: alice, [f.bob.id]: bob });
    assert.equal(goal.status, status);
  }
}

async function assertActivity(f: Fixture, status: string) {
  const result = await request(f.app, f.bob, "GET", "/buddy/activity");
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  const activity = result.body.data.items.find((item: any) => item.id === f.activityId);
  assert.ok(activity);
  assert.equal(activity.status, status);
}

test("HTTP participants in different calendar dates concurrently join one activity-bound sleep session", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-19T23:55:00Z") });
  const f = await fixture();
  context.after(() => f.app.close());
  const [alice, bob] = await Promise.all([begin(f, f.alice, "2026-10-19"), begin(f, f.bob, "2026-10-20")]);
  assert.equal(bob.session_id, alice.session_id, "joint_activity_id must dominate viewer-local date anchors");
  const retry = await begin(f, f.alice, "2026-10-20");
  assert.equal(retry.session_id, alice.session_id);
  const records = await f.app.database.listFrogSleepEntities({ appId: "frogsleep", kind: "sleep_session", relationshipId: f.relationshipId });
  assert.equal(records.length, 1);
});

test("HTTP midnight join reaches one bilateral result and accumulates each participant exactly once", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-19T23:55:00Z") });
  const f = await fixture();
  context.after(() => f.app.close());
  const alice = await begin(f, f.alice, "2026-10-19");
  context.mock.timers.tick(10 * 60_000);
  const bob = await begin(f, f.bob, "2026-10-20");
  await accept(f, f.alice, alice.session_id);
  await accept(f, f.bob, bob.session_id);
  context.mock.timers.tick(7 * 3_600_000);
  await renew(f);
  const morningAt = new Date().toISOString();
  await morningTwice(f, f.alice, alice.session_id, morningAt);
  await assertGoal(f, 1, 0, "active");
  await assertActivity(f, "accepted");
  await morningTwice(f, f.bob, bob.session_id, morningAt);
  await assertGoal(f, 1, 1, "completed");
  await assertActivity(f, "completed");
  assert.equal(bob.session_id, alice.session_id);
  const restored = await begin(f, f.bob, "2026-10-21");
  assert.equal(restored.session_id, alice.session_id);
  assert.equal(restored.status, "completed");
});

test("completed activity recovery on a later date cannot add another sleep day to the goal", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-19T23:55:00Z") });
  const f = await fixture(2);
  context.after(() => f.app.close());
  const original = await begin(f, f.alice, "2026-10-19");
  for (const actor of [f.alice, f.bob]) await accept(f, actor, original.session_id);
  context.mock.timers.tick(7 * 3_600_000);
  await renew(f);
  const occurredAt = new Date().toISOString();
  for (const actor of [f.alice, f.bob]) await morningTwice(f, actor, original.session_id, occurredAt);
  await assertGoal(f, 1, 1, "active");
  await assertActivity(f, "completed");
  context.mock.timers.tick(24 * 3_600_000);
  await renew(f);
  const recovered = await begin(f, f.bob, "2026-10-21");
  assert.equal(recovered.session_id, original.session_id);
  for (const actor of [f.alice, f.bob]) await morningTwice(f, actor, recovered.session_id, occurredAt);
  await assertGoal(f, 1, 1, "active");
});

test("HTTP same-date morning retries retain one day's progress for an unfinished weekly target", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-19T23:55:00Z") });
  const f = await fixture(2);
  context.after(() => f.app.close());
  const first = await begin(f, f.alice, "2026-10-19");
  const second = await begin(f, f.bob, "2026-10-19");
  assert.equal(second.session_id, first.session_id);
  for (const actor of [f.alice, f.bob]) await accept(f, actor, first.session_id);
  const occurredAt = new Date().toISOString();
  for (const actor of [f.alice, f.bob]) await morningTwice(f, actor, first.session_id, occurredAt);
  await assertGoal(f, 1, 1, "active");
  await assertActivity(f, "completed");
});

test("invalid joint activity input cannot silently fall back to a legacy sleep session", async context => {
  const f = await fixture();
  context.after(() => f.app.close());
  for (const value of [17, "", null]) {
    const result = await request(f.app, f.alice, "POST", "/sleep-buddy/shared-sessions", {
      relationship_id: f.relationshipId, joint_activity_id: value, date_anchor: "2026-10-25" });
    assert.equal(result.statusCode, 400, `Invalid activity ${JSON.stringify(value)} must be rejected`);
  }
});

test("offline bilateral mornings within the activity window reconcile after an expired-state read", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-19T23:55:00Z") });
  const f = await fixture();
  context.after(() => f.app.close());
  const original = await begin(f, f.alice, "2026-10-19");
  for (const actor of [f.alice, f.bob]) await accept(f, actor, original.session_id);
  context.mock.timers.tick(7 * 3600_000);
  const occurredAt = new Date().toISOString();
  context.mock.timers.tick(30 * 3600_000);
  await renew(f);
  await assertActivity(f, "expired");
  const restored = await begin(f, f.bob, "2026-10-21");
  assert.equal(restored.session_id, original.session_id);
  for (const actor of [f.alice, f.bob]) await morningTwice(f, actor, original.session_id, occurredAt);
  await assertActivity(f, "completed");
  await assertGoal(f, 1, 1, "completed");
});
