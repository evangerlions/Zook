import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { PostgresDatabase } from "../../src/infrastructure/database/postgres/postgres-database.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { DevelopmentPasswordHasher } from "../../src/modules/auth/password-hasher.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { enableFrogSleepBuddyCapabilities } from "../helpers/enable-frogsleep-buddy-capabilities.ts";

enableFrogSleepBuddyCapabilities();
const databaseUrl = process.env.FROGSLEEP_TEST_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("FROGSLEEP_TEST_DATABASE_URL must point to a disposable PostgreSQL database.");
const runId = `first_completion_${randomUUID().replaceAll("-", "")}`;
type Runtime = Awaited<ReturnType<typeof createApplication>>;
type Actor = { id: string; token: string; email: string };

async function request(app: Runtime, actor: Actor, method: string, path: string, body?: unknown) {
  return await app.app.handle({ method, path: `/api/v1/frogsleep${path}`, body,
    headers: { authorization: `Bearer ${actor.token}` }, requestId: runId } as never);
}

async function actor(app: Runtime, suffix: string): Promise<Actor> {
  const id = `${runId}_${suffix}`, email = `${id}@example.test`;
  await app.database.insertUser({ id, email, passwordHash: "unused", passwordAlgo: "test",
    status: "ACTIVE", createdAt: new Date().toISOString() });
  await app.services.appRegistryService.ensureMembership("frogsleep", id);
  const session = await app.services.authService.issueSession(id, "frogsleep");
  return { id, email, token: session.accessToken };
}

async function relationship(app: Runtime, alice: Actor, bob: Actor, domain = "focus") {
  const invited = await request(app, alice, "POST", "/buddy/invitations", {
    target: { email: bob.email }, domains: [domain] });
  assert.equal(invited.statusCode, 200, JSON.stringify(invited.body));
  const accepted = await request(app, bob, "POST", `/buddy/invitations/${invited.body.data.invitation_id}/domains/${domain}/accept`,
    { expected_version: 1, idempotency_key: `${runId}_accept` });
  assert.equal(accepted.statusCode, 200, JSON.stringify(accepted.body));
  const id = String(accepted.body.data.relationship_id);
  for (const participant of [alice, bob]) await share(app, participant, id);
  return id;
}

async function share(app: Runtime, participant: Actor, relationshipId: string) {
  const listed = await request(app, participant, "GET", `/buddy/relationships/${relationshipId}/grants`);
  assert.equal(listed.statusCode, 200, JSON.stringify(listed.body));
  for (const grant of listed.body.data.grants.filter((item: any) => item.grantor_user_id === participant.id)) {
    const updated = await request(app, participant, "PATCH", `/buddy/relationships/${relationshipId}/grants/${grant.id}`,
      { expected_version: grant.version, state: "granted" });
    assert.equal(updated.statusCode, 200, JSON.stringify(updated.body));
  }
}

async function prepare(app: Runtime, alice: Actor, bob: Actor, relationshipId: string) {
  const createdGoal = await request(app, alice, "POST", "/buddy/goals", {
    relationship_id: relationshipId, type: "focus_minutes", target: 1, timezone: "UTC", idempotency_key: `${runId}_goal` });
  assert.equal(createdGoal.statusCode, 200, JSON.stringify(createdGoal.body));
  const goalId = String(createdGoal.body.data.id);
  const acceptedGoal = await request(app, bob, "POST", `/buddy/goals/${goalId}/accept`, {
    expected_version: 1, idempotency_key: `${runId}_goal_accept` });
  assert.equal(acceptedGoal.statusCode, 200, JSON.stringify(acceptedGoal.body));
  const created = await request(app, alice, "POST", "/buddy/joint-activities", {
    relationship_id: relationshipId, type: "joint_focus", planned_minutes: 1, idempotency_key: `${runId}_activity` });
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const activityId = String(created.body.data.id), path = `/buddy/joint-activities/${activityId}`;
  assert.equal((await request(app, bob, "POST", `${path}/accept`)).statusCode, 200);
  for (const participant of [alice, bob]) {
    assert.equal((await request(app, participant, "POST", `${path}/start`)).statusCode, 200);
  }
  return { goalId, activityId };
}

async function concurrentRetries(app: Runtime, participant: Actor, startedAt: string, endedAt: string) {
  const body = { session_id: `${participant.id}_session`, started_at: startedAt, ended_at: endedAt,
    status: "completed", planned_minutes: 1, actual_minutes: 1, room: "reading", goal: "1m" };
  const results = await Promise.all([request(app, participant, "POST", "/focus-buddy/sessions", body),
    request(app, participant, "POST", "/focus-buddy/sessions", body)]);
  for (const result of results) assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  assert.equal(results[0].body.data.session_id, results[1].body.data.session_id);
  const rows = await app.database.listFrogSleepEntities({ appId: "frogsleep", kind: "focus_session",
    ownerUserId: participant.id, limit: 100 });
  assert.equal(rows.filter(row => row.payload.client_session_id === body.session_id).length, 1);
}

test("PostgreSQL persists first bilateral completion and deduplicates concurrent source retries", async context => {
  const database = await PostgresDatabase.create(databaseUrl,
    buildDefaultSeed(new DevelopmentPasswordHasher(), { includeFrogSleep: true }));
  const app = await createApplication({ frogsleepEnabled: true, queueBackend: "memory", database });
  assert.equal(app.database instanceof InMemoryDatabase, false);
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-12T12:00:00.000Z") });
  try {
    const alice = await actor(app, "alice"), bob = await actor(app, "bob");
    const id = await relationship(app, alice, bob);
    const { goalId, activityId } = await prepare(app, alice, bob, id);
    const startedAt = new Date().toISOString();
    context.mock.timers.tick(60_000);
    const endedAt = new Date().toISOString();
    await concurrentRetries(app, alice, startedAt, endedAt);
    const partial = await request(app, bob, "GET", "/buddy/activity");
    assert.equal(partial.body.data.items.find((item: any) => item.id === activityId).status, "accepted");
    await concurrentRetries(app, bob, startedAt, endedAt);
    await assertPersistedCompletion(app, alice, bob, goalId, activityId);
    await context.test("concurrent goal adjustments reject the losing expected version", async () => {
      await concurrentGoalAdjustments(app, alice, bob, id);
    });
  } finally {
    await app.close();
  }
});

async function assertPersistedCompletion(app: Runtime, alice: Actor, bob: Actor, goalId: string, activityId: string) {
  const feed = await request(app, alice, "GET", "/buddy/activity");
  assert.equal(feed.statusCode, 200, JSON.stringify(feed.body));
  assert.equal(feed.body.data.items.find((item: any) => item.id === activityId).status, "completed");
  for (const participant of [alice, bob]) {
    const listed = await request(app, participant, "GET", "/buddy/goals");
    assert.equal(listed.statusCode, 200, JSON.stringify(listed.body));
    const goal = listed.body.data.goals.find((item: any) => item.id === goalId);
    assert.equal(goal.status, "completed");
    assert.deepEqual(goal.participant_progress, { [alice.id]: 1, [bob.id]: 1 });
  }
  const activity = await app.database.findFrogSleepEntity("buddy_joint_activity", "frogsleep", activityId);
  const goal = await app.database.findFrogSleepEntity("buddy_joint_goal", "frogsleep", goalId);
  assert.equal(activity?.status, "completed");
  assert.equal(goal?.status, "completed");
  const notifications = await app.database.listReadyFrogSleepBuddyNotificationOutbox(new Date().toISOString(), 500);
  const completed = notifications.filter(item => item.targetId === goalId &&
    item.deduplicationKey.startsWith("goal-completed:"));
  assert.equal(completed.length, 2, "goal completion notifies each participant exactly once across reads and retries");
  assert.deepEqual(completed.map(item => item.recipientUserId).sort(), [alice.id, bob.id].sort());
}

async function concurrentGoalAdjustments(app: Runtime, alice: Actor, bob: Actor, relationshipId: string) {
  const created = await request(app, alice, "POST", "/buddy/goals", {
    relationship_id: relationshipId, type: "focus_days", target: 1, timezone: "UTC", idempotency_key: `${runId}_race_goal` });
  assert.equal(created.statusCode, 200);
  const path = `/buddy/goals/${created.body.data.id}`;
  const accepted = await request(app, bob, "POST", `${path}/accept`, {
    expected_version: 1, idempotency_key: `${runId}_race_accept` });
  assert.equal(accepted.statusCode, 200);
  const results = await Promise.all([
    request(app, alice, "POST", `${path}/adjust`, {
      target: 2, expected_version: 2, idempotency_key: `${runId}_race_alice` }),
    request(app, bob, "POST", `${path}/adjust`, {
      target: 3, expected_version: 2, idempotency_key: `${runId}_race_bob` }),
  ]);
  assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 409]);
}

test("PostgreSQL keeps one joint sleep session across midnight, retries, and runtime restart", async context => {
  const database = await PostgresDatabase.create(databaseUrl,
    buildDefaultSeed(new DevelopmentPasswordHasher(), { includeFrogSleep: true }));
  const accessTokenSecret = "local-p0-postgres-restart-acceptance";
  let app = await createApplication({ frogsleepEnabled: true, queueBackend: "memory", database, accessTokenSecret });
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-19T23:55:00.000Z") });
  try {
    const alice = await actor(app, "sleep_alice"), bob = await actor(app, "sleep_bob");
    const id = await relationship(app, alice, bob, "sleep");
    const { goalId, activityId } = await prepareSleep(app, alice, bob, id);
    const sessionId = await joinSleepAcrossDates(app, alice, bob, id, activityId);
    context.mock.timers.tick(7 * 3600_000);
    for (const participant of [alice, bob]) {
      participant.token = (await app.services.authService.issueSession(participant.id, "frogsleep")).accessToken;
    }
    await sleepMorning(app, alice, sessionId);
    await assertSleepResult(app, bob, activityId, goalId, alice, bob, false);
    await sleepMorning(app, bob, sessionId);
    await assertSleepResult(app, alice, activityId, goalId, alice, bob, true);
    await app.close();
    app = await createApplication({ frogsleepEnabled: true, queueBackend: "memory", accessTokenSecret,
      database: await PostgresDatabase.create(databaseUrl) });
    const restored = await request(app, bob, "POST", "/sleep-buddy/shared-sessions", {
      relationship_id: id, joint_activity_id: activityId, date_anchor: "2026-10-21" });
    assert.equal(restored.statusCode, 200, JSON.stringify(restored.body));
    assert.equal(restored.body.data.session_id, sessionId);
    await sleepMorning(app, bob, sessionId);
    await assertSleepResult(app, alice, activityId, goalId, alice, bob, true);
  } finally { await app.close(); }
});

async function prepareSleep(app: Runtime, alice: Actor, bob: Actor, relationshipId: string) {
  const goal = await request(app, alice, "POST", "/buddy/goals", {
    relationship_id: relationshipId, type: "sleep_schedule_days", target: 1,
    timezone: "UTC", idempotency_key: `${runId}_sleep_goal` });
  assert.equal(goal.statusCode, 200, JSON.stringify(goal.body));
  const goalId = String(goal.body.data.id);
  const accepted = await request(app, bob, "POST", `/buddy/goals/${goalId}/accept`, {
    expected_version: 1, idempotency_key: `${runId}_sleep_goal_accept` });
  assert.equal(accepted.statusCode, 200, JSON.stringify(accepted.body));
  const activity = await request(app, alice, "POST", "/buddy/joint-activities", {
    relationship_id: relationshipId, type: "tonight_together", idempotency_key: `${runId}_sleep_activity` });
  assert.equal(activity.statusCode, 200, JSON.stringify(activity.body));
  const activityId = String(activity.body.data.id), path = `/buddy/joint-activities/${activityId}`;
  assert.equal((await request(app, bob, "POST", `${path}/accept`)).statusCode, 200);
  for (const participant of [alice, bob]) assert.equal((await request(app, participant, "POST", `${path}/start`)).statusCode, 200);
  return { goalId, activityId };
}

async function joinSleepAcrossDates(app: Runtime, alice: Actor, bob: Actor, relationshipId: string, activityId: string) {
  const results = await Promise.all([alice, bob].map((participant, index) => request(app, participant, "POST",
    "/sleep-buddy/shared-sessions", { relationship_id: relationshipId, joint_activity_id: activityId,
      date_anchor: index ? "2026-10-20" : "2026-10-19" })));
  for (const result of results) assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  const id = String(results[0].body.data.session_id);
  assert.equal(results[1].body.data.session_id, id);
  const sessions = await app.database.listFrogSleepEntities({ appId: "frogsleep", kind: "sleep_session", relationshipId });
  assert.equal(sessions.length, 1);
  for (const participant of [alice, bob]) {
    assert.equal((await request(app, participant, "POST", `/sleep-buddy/shared-sessions/${id}/accept`)).statusCode, 200);
  }
  return id;
}

async function sleepMorning(app: Runtime, participant: Actor, id: string) {
  for (let retry = 0; retry < 2; retry += 1) {
    const result = await request(app, participant, "POST", `/sleep-buddy/shared-sessions/${id}/events`, {
      event_type: "morning_completed", occurred_at: new Date().toISOString() });
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  }
}

async function assertSleepResult(app: Runtime, viewer: Actor, activityId: string, goalId: string,
  alice: Actor, bob: Actor, completed: boolean) {
  const feed = await request(app, viewer, "GET", "/buddy/activity");
  assert.equal(feed.statusCode, 200, JSON.stringify(feed.body));
  assert.equal(feed.body.data.items.find((item: any) => item.id === activityId).status, completed ? "completed" : "accepted");
  const goals = await request(app, viewer, "GET", "/buddy/goals");
  assert.equal(goals.statusCode, 200, JSON.stringify(goals.body));
  const goal = goals.body.data.goals.find((item: any) => item.id === goalId);
  assert.equal(goal.status, completed ? "completed" : "active");
  assert.deepEqual(goal.participant_progress, { [alice.id]: 1, [bob.id]: completed ? 1 : 0 });
}
