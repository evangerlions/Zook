import assert from "node:assert/strict";
import test from "node:test";
import { enableFrogSleepBuddyCapabilities } from "../helpers/enable-frogsleep-buddy-capabilities.ts";

enableFrogSleepBuddyCapabilities();
import { createApplication } from "../../src/app.module.ts";
import { BuddyJointGoalService, weeklyWindow } from "../../src/modules/frogsleep/buddy-growth/buddy-joint-goal.service.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

async function runtime() {
  return await createApplication({ frogsleepEnabled: true, queueBackend: "memory",
    databaseFactory: (seed) => new InMemoryDatabase(seed) });
}

async function login(app: Awaited<ReturnType<typeof runtime>>, account: string) {
  const response = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/auth/password/login",
    headers: {}, body: { account, password: "Password1234" }, requestId: `goal_login_${account}` } as never);
  return String(response.body.data.access_token);
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function relationship(app: Awaited<ReturnType<typeof runtime>>, alice: string, bob: string) {
  const invite = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/sleep-buddy/invites",
    headers: auth(alice), body: { invitee: "user_bob" }, requestId: "goal_invite" } as never);
  const accepted = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/sleep-buddy/invites/accept-code",
    headers: auth(bob), body: { code: invite.body.data.code }, requestId: "goal_accept_invite" } as never);
  return String(accepted.body.data.relationship_id);
}

test("joint goal proposal requires bilateral acceptance and versioned idempotent actions", async () => {
  const app = await runtime(); const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com"); const relationshipId = await relationship(app, alice, bob);
  const createBody = { relationship_id: relationshipId, type: "focus_minutes", target: 120,
    timezone: "Asia/Shanghai", idempotency_key: "goal-create-1" };
  const created = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/buddy/goals",
    headers: auth(alice), body: createBody, requestId: "goal_create" } as never);
  assert.equal(created.statusCode, 200, JSON.stringify(created.body)); assert.equal(created.body.data.status, "proposed");
  assert.equal(created.body.data.participant_consents.user_alice, "accepted");
  assert.equal(created.body.data.participant_consents.user_bob, "pending");

  const replay = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/buddy/goals",
    headers: auth(alice), body: createBody, requestId: "goal_create_replay" } as never);
  assert.equal(replay.body.data.id, created.body.data.id);
  const accepted = await app.app.handle({ method: "POST",
    path: `/api/v1/frogsleep/buddy/goals/${created.body.data.id}/accept`, headers: auth(bob),
    body: { expected_version: 1, idempotency_key: "goal-accept-1" }, requestId: "goal_accept" } as never);
  assert.equal(accepted.body.data.status, "active"); assert.equal(accepted.body.data.version, 2);
  const acceptedReplay = await app.app.handle({ method: "POST",
    path: `/api/v1/frogsleep/buddy/goals/${created.body.data.id}/accept`, headers: auth(bob),
    body: { expected_version: 1, idempotency_key: "goal-accept-1" }, requestId: "goal_accept_replay" } as never);
  assert.equal(acceptedReplay.body.data.version, 2);
  assert.equal(app.database.frogSleepBuddyNotificationOutbox.filter((item) =>
    item.targetType === "buddy_joint_goal").length, 2);
});

test("goal adjustment returns to bilateral consent and verified source events deduplicate", async () => {
  const app = await runtime(); const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com"); const relationshipId = await relationship(app, alice, bob);
  const created = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/buddy/goals", headers: auth(alice),
    body: { relationship_id: relationshipId, type: "focus_days", target: 3, timezone: "UTC",
      idempotency_key: "adjust-create" }, requestId: "adjust_create" } as never);
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  await app.app.handle({ method: "POST", path: `/api/v1/frogsleep/buddy/goals/${created.body.data.id}/accept`,
    headers: auth(bob), body: { expected_version: 1, idempotency_key: "adjust-accept" }, requestId: "adjust_accept" } as never);
  const adjusted = await app.app.handle({ method: "POST", path: `/api/v1/frogsleep/buddy/goals/${created.body.data.id}/adjust`,
    headers: auth(alice), body: { expected_version: 2, idempotency_key: "adjust-once", target: 4 }, requestId: "adjust" } as never);
  assert.equal(adjusted.body.data.status, "proposed"); assert.equal(adjusted.body.data.target, 4);
  assert.equal(adjusted.body.data.participant_consents.user_bob, "pending");
  const reaccepted = await app.app.handle({ method: "POST",
    path: `/api/v1/frogsleep/buddy/goals/${created.body.data.id}/accept`, headers: auth(bob),
    body: { expected_version: 3, idempotency_key: "adjust-reaccept" }, requestId: "adjust_reaccept" } as never);
  assert.equal(reaccepted.body.data.status, "active");
  const paused = await app.app.handle({ method: "POST",
    path: `/api/v1/frogsleep/buddy/goals/${created.body.data.id}/pause`, headers: auth(alice),
    body: { expected_version: 4, idempotency_key: "goal-pause" }, requestId: "goal_pause" } as never);
  assert.equal(paused.body.data.status, "paused");
  const completed = await app.app.handle({ method: "POST",
    path: `/api/v1/frogsleep/buddy/goals/${created.body.data.id}/complete`, headers: auth(bob),
    body: { expected_version: 5, idempotency_key: "goal-complete" }, requestId: "goal_complete" } as never);
  assert.equal(completed.body.data.status, "completed");

  const now = new Date().toISOString();
  await app.database.insertFrogSleepEntity({ id: "focus_verified", appId: "frogsleep", kind: "focus_session",
    ownerUserId: "user_alice", status: "completed", payload: {}, createdAt: now, updatedAt: now });
  const service = new BuddyJointGoalService(app.database);
  const contribution = { relationshipId, userId: "user_alice", sourceEventId: "focus_verified",
    sourceKind: "focus_session" as const, amount: 1, occurredAt: now };
  await service.recordVerifiedContribution(contribution); await service.recordVerifiedContribution(contribution);
  const stored = await app.database.listFrogSleepEntities({ appId: "frogsleep", kind: "buddy_goal_contribution",
    relationshipId, limit: 10 });
  assert.equal(stored.length, 1);
});

test("weekly windows honor viewer timezone and DST boundaries", () => {
  const shanghai = weeklyWindow(new Date("2026-07-15T12:00:00Z"), "Asia/Shanghai");
  assert.equal(shanghai.start, "2026-07-12T16:00:00.000Z");
  assert.equal(shanghai.end, "2026-07-19T16:00:00.000Z");
  const newYork = weeklyWindow(new Date("2026-03-10T12:00:00Z"), "America/New_York");
  assert.equal(newYork.start, "2026-03-09T04:00:00.000Z");
  assert.equal(newYork.end, "2026-03-16T04:00:00.000Z");
});
