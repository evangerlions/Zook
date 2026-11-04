import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { PostgresDatabase } from "../../src/infrastructure/database/postgres/postgres-database.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { DevelopmentPasswordHasher } from "../../src/modules/auth/password-hasher.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { enableFrogSleepBuddyCapabilities } from "../helpers/enable-frogsleep-buddy-capabilities.ts";

enableFrogSleepBuddyCapabilities();
type Runtime = Awaited<ReturnType<typeof createApplication>>;
type Fixture = Awaited<ReturnType<typeof fixture>>;
const postgresUrl = process.env.FROGSLEEP_SESSION_TEST_DATABASE_URL?.trim();
let postgresRuntime: Promise<Runtime> | undefined;

after(async () => {
  if (postgresRuntime) await (await postgresRuntime).close();
});

async function runtime() {
  if (!postgresUrl) return createApplication({ frogsleepEnabled: true, queueBackend: "memory",
    databaseFactory: seed => new InMemoryDatabase(seed) });
  postgresRuntime ??= (async () => {
    const seed = buildDefaultSeed(new DevelopmentPasswordHasher(), { includeFrogSleep: true });
    const database = await PostgresDatabase.create(postgresUrl, seed);
    try {
      return await createApplication({ frogsleepEnabled: true, queueBackend: "memory", database });
    } catch (error) {
      await database.close();
      throw error;
    }
  })();
  return postgresRuntime;
}

async function request(app: Runtime, token: string, method: string, path: string, body?: unknown) {
  return app.app.handle({ method, path: `/api/v1/frogsleep${path}`, body,
    headers: { authorization: `Bearer ${token}` }, requestId: "tonight_session_identity" } as never);
}

async function grantSharing(app: Runtime, token: string, relationshipId: string, owner: string) {
  const listed = await request(app, token, "GET", `/buddy/relationships/${relationshipId}/grants`);
  assert.equal(listed.statusCode, 200, JSON.stringify(listed.body));
  for (const grant of listed.body.data.grants.filter((item: any) => item.grantor_user_id === owner)) {
    const updated = await request(app, token, "PATCH", `/buddy/relationships/${relationshipId}/grants/${grant.id}`,
      { expected_version: grant.version, state: "granted" });
    assert.equal(updated.statusCode, 200, JSON.stringify(updated.body));
  }
}

async function actor(app: Runtime, name: string) {
  const id = `tonight_${randomUUID().replaceAll("-", "")}_${name}`, email = `${id}@example.test`;
  await app.database.insertUser({ id, email, passwordHash: "unused", passwordAlgo: "test",
    status: "ACTIVE", createdAt: new Date().toISOString() });
  await app.services.appRegistryService.ensureMembership("frogsleep", id);
  const token = (await app.services.authService.issueSession(id, "frogsleep")).accessToken;
  return { id, email, token };
}

async function acceptedRelationship(app: Runtime, alice: Awaited<ReturnType<typeof actor>>, bob: Awaited<ReturnType<typeof actor>>) {
  const invitation = await request(app, alice.token, "POST", "/buddy/invitations",
    { target: { email: bob.email }, domains: ["sleep"] });
  assert.equal(invitation.statusCode, 200, JSON.stringify(invitation.body));
  const accepted = await request(app, bob.token, "POST", `/buddy/invitations/${invitation.body.data.invitation_id}/domains/sleep/accept`,
    { expected_version: 1, idempotency_key: "tonight_relationship" });
  assert.equal(accepted.statusCode, 200, JSON.stringify(accepted.body));
  return String(accepted.body.data.relationship_id);
}

async function fixture() {
  const app = await runtime();
  if (postgresUrl) assert.ok(app.database instanceof PostgresDatabase, "must exercise real PostgreSQL storage");
  const alice = await actor(app, "alice"), bob = await actor(app, "bob");
  const relationshipId = await acceptedRelationship(app, alice, bob);
  await grantSharing(app, alice.token, relationshipId, alice.id);
  await grantSharing(app, bob.token, relationshipId, bob.id);
  const activityId = await startedActivity(app, alice.token, bob.token, relationshipId);
  return { app, alice: alice.token, bob: bob.token, aliceId: alice.id, bobId: bob.id, relationshipId, activityId };
}

async function startedActivity(app: Runtime, alice: string, bob: string, relationshipId: string) {
  const created = await request(app, alice, "POST", "/buddy/joint-activities",
    { relationship_id: relationshipId, type: "tonight_together", idempotency_key: "tonight_identity" });
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const id = String(created.body.data.id), path = `/buddy/joint-activities/${id}`;
  assert.equal((await request(app, bob, "POST", `${path}/accept`)).statusCode, 200);
  for (const token of [alice, bob]) {
    assert.equal((await request(app, token, "POST", `${path}/start`)).statusCode, 200);
  }
  return id;
}

async function begin(f: Fixture, token: string, anchor: string) {
  const response = await request(f.app, token, "POST", "/sleep-buddy/shared-sessions", {
    relationship_id: f.relationshipId, date_anchor: anchor, joint_activity_id: f.activityId });
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  return response.body.data;
}

async function sleepSessions(f: Fixture) {
  return f.app.database.listFrogSleepEntities({ appId: "frogsleep", kind: "sleep_session",
    relationshipId: f.relationshipId });
}

test("the same tonight activity retains one shared session when the second participant joins across UTC midnight", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-23T23:59:00.000Z") });
  const f = await fixture();
  const alice = await begin(f, f.alice, "2026-10-23");
  context.mock.timers.tick(2 * 60_000);

  const bob = await begin(f, f.bob, "2026-10-24");

  assert.equal(bob.session_id, alice.session_id,
    "a client-local date change must not split one accepted tonight activity");
  assert.equal(bob.date_anchor, alice.date_anchor);
  assert.equal((await sleepSessions(f)).length, 1);
});

test("concurrent joins from Shanghai and Los Angeles converge on one session for their tonight activity", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-23T16:30:00.000Z") });
  const f = await fixture();
  const localDate = (timeZone: string) => new Intl.DateTimeFormat("en-CA",
    { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const shanghai = localDate("Asia/Shanghai"), losAngeles = localDate("America/Los_Angeles");
  assert.notEqual(shanghai, losAngeles);

  const sessions = await Promise.all([begin(f, f.alice, shanghai), begin(f, f.bob, losAngeles),
    begin(f, f.alice, shanghai), begin(f, f.bob, losAngeles)]);

  assert.equal(new Set(sessions.map(session => session.session_id)).size, 1,
    "per-relationship locking must deduplicate by the joint activity rather than the client's date");
  assert.equal((await sleepSessions(f)).length, 1);
});

async function completedSession(f: Fixture) {
  const session = await begin(f, f.alice, "2026-10-23");
  for (const token of [f.alice, f.bob]) {
    const accepted = await request(f.app, token, "POST", `/sleep-buddy/shared-sessions/${session.session_id}/accept`);
    assert.equal(accepted.statusCode, 200, JSON.stringify(accepted.body));
  }
  const results = await Promise.all([f.alice, f.bob, f.alice, f.bob].map(token =>
    request(f.app, token, "POST", `/sleep-buddy/shared-sessions/${session.session_id}/events`,
      { event_type: "morning_completed" })));
  for (const result of results) assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  return session;
}

test("concurrent completion retries persist one terminal event per participant and notify completion once", async () => {
  const f = await fixture();
  const session = await completedSession(f);
  const stored = await f.app.database.findFrogSleepEntity("sleep_session", "frogsleep", session.session_id);
  assert.equal(stored?.status, "completed");
  const events = await f.app.database.listFrogSleepEntities({ appId: "frogsleep", kind: "sleep_event",
    sessionId: session.session_id, status: "morning_completed" });
  assert.equal(events.length, 2);
  for (const token of [f.alice, f.bob, f.alice]) {
    const feed = await request(f.app, token, "GET", "/buddy/activity");
    assert.equal(feed.statusCode, 200, JSON.stringify(feed.body));
    assert.equal(feed.body.data.items.find((item: any) => item.id === f.activityId)?.status, "completed");
  }
  const outbox = await f.app.database.listReadyFrogSleepBuddyNotificationOutbox(new Date().toISOString(), 500);
  const notifications = outbox.filter(item =>
    item.deduplicationKey.startsWith(`joint-completed:${f.activityId}:`));
  assert.equal(notifications.length, 2);
  assert.equal(new Set(notifications.map(item => item.recipientUserId)).size, 2);
});

test("retrying a completed tonight activity on another client date cannot create a second session", async () => {
  const f = await fixture();
  const completed = await completedSession(f);
  const feed = await request(f.app, f.alice, "GET", "/buddy/activity");
  assert.equal(feed.body.data.items.find((item: any) => item.id === f.activityId)?.status, "completed");

  const replay = await begin(f, f.bob, "2026-10-24");

  assert.equal(replay.session_id, completed.session_id);
  assert.equal(replay.status, "completed");
  assert.equal((await sleepSessions(f)).length, 1);
});

async function assertRejectedWithoutSession(f: Fixture, activityId: string) {
  const response = await request(f.app, f.alice, "POST", "/sleep-buddy/shared-sessions", {
    relationship_id: f.relationshipId, date_anchor: "2026-10-24", joint_activity_id: activityId });
  assert.ok(response.statusCode >= 400 && response.statusCode < 500,
    `unavailable activity must return a client error: ${JSON.stringify(response.body)}`);
  assert.equal((await sleepSessions(f)).length, 0);
}

test("an unknown joint activity cannot create a shared session", async () => {
  const f = await fixture();

  await assertRejectedWithoutSession(f, "buddy_joint_activity_missing");
});

test("an activity belonging to another relationship cannot create a shared session in the caller's relationship", async () => {
  const f = await fixture();
  const original = await f.app.database.findFrogSleepEntity("buddy_joint_activity", "frogsleep", f.activityId);
  assert.ok(original);
  const foreignRelationshipId = `${f.activityId}_foreign_relationship`;
  await f.app.database.insertFrogSleepEntity({ id: foreignRelationshipId, appId: "frogsleep", kind: "sleep_relationship",
    ownerUserId: "user_blocked", partnerUserId: f.bobId, status: "active", payload: {},
    createdAt: original.createdAt, updatedAt: original.updatedAt });
  const foreignActivityId = `${f.activityId}_foreign`;
  await f.app.database.insertFrogSleepEntity({ ...original, id: foreignActivityId,
    relationshipId: foreignRelationshipId, ownerUserId: "user_blocked", partnerUserId: f.bobId });

  await assertRejectedWithoutSession(f, foreignActivityId);
});

test("a non-tonight activity cannot create a shared sleep session", async () => {
  const f = await fixture();
  const original = await f.app.database.findFrogSleepEntity("buddy_joint_activity", "frogsleep", f.activityId);
  assert.ok(original);
  const focusActivityId = `${f.activityId}_wrong_type`;
  await f.app.database.insertFrogSleepEntity({ ...original, id: focusActivityId,
    payload: { ...original.payload, type: "joint_focus" } });

  await assertRejectedWithoutSession(f, focusActivityId);
});

for (const status of ["pending", "declined", "cancelled"] as const) {
  test(`a ${status} tonight activity cannot create a shared sleep session`, async () => {
    const f = await fixture();
    const created = await request(f.app, f.alice, "POST", "/buddy/joint-activities", {
      relationship_id: f.relationshipId, type: "tonight_together", idempotency_key: `tonight_${status}` });
    assert.equal(created.statusCode, 200, JSON.stringify(created.body));
    const activityId = String(created.body.data.id);
    if (status !== "pending") {
      const actor = status === "declined" ? f.bob : f.alice;
      const action = status === "declined" ? "decline" : "cancel";
      const transitioned = await request(f.app, actor, "POST", `/buddy/joint-activities/${activityId}/${action}`);
      assert.equal(transitioned.statusCode, 200, JSON.stringify(transitioned.body));
      assert.equal(transitioned.body.data.status, status);
    }

    await assertRejectedWithoutSession(f, activityId);
  });
}

test("a completed activity without an originating shared session cannot manufacture a fresh one", async () => {
  const f = await fixture();
  const updated = await f.app.database.updateFrogSleepEntity("buddy_joint_activity", "frogsleep", f.activityId,
    { status: "completed" });
  assert.equal(updated?.status, "completed");

  await assertRejectedWithoutSession(f, f.activityId);
});
