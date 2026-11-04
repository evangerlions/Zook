import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { BuddyJointGoalService } from "../../src/modules/frogsleep/buddy-growth/buddy-joint-goal.service.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { enableFrogSleepBuddyCapabilities } from "../helpers/enable-frogsleep-buddy-capabilities.ts";

enableFrogSleepBuddyCapabilities();
type Runtime = Awaited<ReturnType<typeof createApplication>>;
const prefix = "/api/v1/frogsleep";

async function request(app: Runtime, token: string, method: string, path: string, body?: unknown) {
  return await app.app.handle({ method, path: `${prefix}${path}`, body,
    headers: { authorization: `Bearer ${token}` }, requestId: "first_completion" } as never);
}

async function fixture(domain: "focus" | "sleep", canonical = true) {
  const app = await createApplication({ frogsleepEnabled: true, queueBackend: "memory",
    databaseFactory: seed => new InMemoryDatabase(seed) });
  const tokens: string[] = [];
  for (const account of ["alice@example.com", "bob@example.com"]) {
    const result = await request(app, "", "POST", "/auth/password/login", { account, password: "Password1234" });
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    tokens.push(String(result.body.data.access_token));
  }
  const [alice, bob] = tokens;
  let relationshipId = "first_completion_legacy";
  if (canonical) {
    const invited = await request(app, alice, "POST", "/buddy/invitations",
      { target: { email: "bob@example.com" }, domains: [domain] });
    assert.equal(invited.statusCode, 200, JSON.stringify(invited.body));
    const accepted = await request(app, bob, "POST", `/buddy/invitations/${invited.body.data.invitation_id}/domains/${domain}/accept`,
      { expected_version: 1, idempotency_key: `accept_${domain}` });
    assert.equal(accepted.statusCode, 200, JSON.stringify(accepted.body));
    relationshipId = String(accepted.body.data.relationship_id);
  } else {
    const now = new Date().toISOString();
    await app.database.insertFrogSleepEntity({ id: relationshipId, appId: "frogsleep",
      kind: domain === "focus" ? "focus_relationship" : "sleep_relationship", ownerUserId: "user_alice",
      partnerUserId: "user_bob", status: domain === "focus" ? "accepted" : "active",
      payload: {}, createdAt: now, updatedAt: now });
  }
  await grantSharing(app, alice, relationshipId, "user_alice");
  await grantSharing(app, bob, relationshipId, "user_bob");
  return { app, alice, bob, relationshipId };
}

async function grantSharing(app: Runtime, token: string, id: string, userId: string) {
  const response = await request(app, token, "GET", `/buddy/relationships/${id}/grants`);
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  for (const grant of response.body.data.grants.filter((item: any) => item.grantor_user_id === userId && item.state !== "granted")) {
    const result = await request(app, token, "PATCH", `/buddy/relationships/${id}/grants/${grant.id}`,
      { expected_version: grant.version, state: "granted" });
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  }
}

async function activeGoal(f: Awaited<ReturnType<typeof fixture>>, type = "focus_days", target = 1) {
  const created = await request(f.app, f.alice, "POST", "/buddy/goals", {
    relationship_id: f.relationshipId, type, target, timezone: "UTC", idempotency_key: `goal_${type}` });
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const accepted = await request(f.app, f.bob, "POST", `/buddy/goals/${created.body.data.id}/accept`,
    { expected_version: 1, idempotency_key: "goal_accept" });
  assert.equal(accepted.statusCode, 200, JSON.stringify(accepted.body));
  return accepted.body.data;
}

for (const domain of ["focus", "sleep"] as const) {
  test(`canonical ${domain} relationship appears in hub and supports its domain goal`, async () => {
    const f = await fixture(domain);
    const hub = await request(f.app, f.alice, "GET", "/buddy/hub");
    assert.equal(hub.statusCode, 200, JSON.stringify(hub.body));
    const partner = hub.body.data.partners.find((item: any) => item.user_id === "user_bob");
    assert.ok(partner, "accepted canonical relationship must be discoverable in the buddy center");
    assert.ok(partner.relationships.some((item: any) => item.relationship_id === f.relationshipId));
    const goal = await activeGoal(f, domain === "focus" ? "focus_days" : "sleep_schedule_days");
    assert.equal(goal.status, "active");
  });
}

test("a participant cannot manually complete a goal before both verified targets are reached", async () => {
  const f = await fixture("focus", false);
  const goal = await activeGoal(f);
  const completed = await request(f.app, f.alice, "POST", `/buddy/goals/${goal.id}/complete`,
    { expected_version: goal.version, idempotency_key: "premature_complete" });
  assert.equal(completed.statusCode, 409, "a completion command must not manufacture verified progress");
  const listed = await request(f.app, f.bob, "GET", "/buddy/goals");
  assert.equal(listed.body.data.goals.find((item: any) => item.id === goal.id).status, "active");
});

test("accepting an activity cannot authorize completion without real sessions", async () => {
  const f = await fixture("focus", false);
  const created = await request(f.app, f.alice, "POST", "/buddy/joint-activities", {
    relationship_id: f.relationshipId, type: "joint_focus", planned_minutes: 25, idempotency_key: "activity_unverified" });
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const path = `/buddy/joint-activities/${created.body.data.id}`;
  const accepted = await request(f.app, f.bob, "POST", `${path}/accept`);
  assert.equal(accepted.body.data.status, "accepted");
  const completed = await request(f.app, f.bob, "POST", `${path}/complete`);
  assert.equal(completed.statusCode, 409, "accepted invitations are not completed joint activities");
});

test("sleep and encouragement sources cannot increase a focus-days goal", async () => {
  const f = await fixture("focus", false);
  const goal = await activeGoal(f);
  const now = new Date().toISOString();
  const service = new BuddyJointGoalService(f.app.database);
  for (const kind of ["sleep_summary", "buddy_interaction"] as const) {
    const id = `wrong_source_${kind}`;
    await f.app.database.insertFrogSleepEntity({ id, appId: "frogsleep", kind,
      ownerUserId: "user_alice", partnerUserId: "user_bob", relationshipId: f.relationshipId,
      status: kind === "sleep_summary" ? "completed" : "sent", occurredAt: now,
      payload: kind === "sleep_summary" ? { completed: true, schedule_met: true } : { type: "encouragement" },
      createdAt: now, updatedAt: now });
    await service.recordVerifiedContribution({ relationshipId: f.relationshipId, userId: "user_alice",
      sourceEventId: id, sourceKind: kind, amount: 1, occurredAt: now });
  }
  const listed = await request(f.app, f.alice, "GET", "/buddy/goals");
  const actual = listed.body.data.goals.find((item: any) => item.id === goal.id);
  assert.equal(actual.participant_progress.user_alice, 0);
  assert.equal(actual.participant_progress.user_bob, 0);
  assert.equal(actual.status, "active");
});

test("both real focus uploads complete the accepted activity and goals once despite retries", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-12T12:00:00.000Z") });
  const f = await fixture("focus");
  const minutesGoal = await activeGoal(f, "focus_minutes", 25);
  const daysGoal = await activeGoal(f, "focus_days", 1);
  const created = await request(f.app, f.alice, "POST", "/buddy/joint-activities", {
    relationship_id: f.relationshipId, type: "joint_focus", planned_minutes: 25, idempotency_key: "activity_real" });
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const activityPath = `/buddy/joint-activities/${created.body.data.id}`;
  assert.equal((await request(f.app, f.bob, "POST", `${activityPath}/accept`)).statusCode, 200);
  for (const token of [f.alice, f.bob]) {
    const started = await request(f.app, token, "POST", `${activityPath}/start`);
    assert.equal(started.statusCode, 200, JSON.stringify(started.body));
  }
  const startedAt = new Date().toISOString();
  context.mock.timers.tick(25 * 60_000);
  await renewTokens(f);
  const endedAt = new Date().toISOString();
  await uploadTwice(f.app, f.alice, "alice_actual_focus", startedAt, endedAt);
  let activity = await activityFromFeed(f.app, f.bob, created.body.data.id);
  assert.equal(activity.status, "accepted", "one participant completing is insufficient");
  await uploadTwice(f.app, f.bob, "bob_actual_focus", startedAt, endedAt);
  activity = await activityFromFeed(f.app, f.alice, created.body.data.id);
  assert.equal(activity.status, "completed");
  await assertCompletedGoal(f.app, f.alice, minutesGoal.id, 25);
  await assertCompletedGoal(f.app, f.bob, daysGoal.id, 1);
});

async function uploadTwice(app: Runtime, token: string, id: string, startedAt: string, endedAt: string) {
  const body = { session_id: id, started_at: startedAt, ended_at: endedAt,
    status: "completed", actual_minutes: 25, planned_minutes: 25, room: "reading", goal: "25m" };
  const first = await request(app, token, "POST", "/focus-buddy/sessions", body);
  const retry = await request(app, token, "POST", "/focus-buddy/sessions", body);
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
  assert.equal(retry.body.data.session_id, first.body.data.session_id, "stable local session IDs must deduplicate uploads");
}

async function activityFromFeed(app: Runtime, token: string, id: string) {
  const response = await request(app, token, "GET", "/buddy/activity");
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  const activity = response.body.data.items.find((item: any) => item.id === id);
  assert.ok(activity);
  return activity;
}

async function assertCompletedGoal(app: Runtime, token: string, id: string, progress: number) {
  const response = await request(app, token, "GET", "/buddy/goals");
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  const goal = response.body.data.goals.find((item: any) => item.id === id);
  assert.equal(goal.participant_progress.user_alice, progress);
  assert.equal(goal.participant_progress.user_bob, progress);
  assert.equal(goal.status, "completed");
}

test("two completed sessions on one local date count as one focus day", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-12T12:00:00.000Z") });
  const f = await fixture("focus");
  const goal = await activeGoal(f, "focus_days", 2);
  for (const id of ["first_same_day", "second_same_day"]) {
    const startedAt = new Date().toISOString();
    context.mock.timers.tick(25 * 60_000);
    await renewTokens(f);
    await uploadTwice(f.app, f.alice, id, startedAt, new Date().toISOString());
  }
  const listed = await request(f.app, f.alice, "GET", "/buddy/goals");
  assert.equal(listed.statusCode, 200, JSON.stringify(listed.body));
  const actual = listed.body.data.goals.find((item: any) => item.id === goal.id);
  assert.equal(actual.participant_progress.user_alice, 1);
  assert.equal(actual.participant_progress.user_bob, 0);
  assert.equal(actual.status, "active");
});

async function renewTokens(f: Awaited<ReturnType<typeof fixture>>) {
  f.alice = (await f.app.services.authService.issueSession("user_alice", "frogsleep")).accessToken;
  f.bob = (await f.app.services.authService.issueSession("user_bob", "frogsleep")).accessToken;
}

async function startedActivity(f: Awaited<ReturnType<typeof fixture>>, type: string) {
  const created = await request(f.app, f.alice, "POST", "/buddy/joint-activities", {
    relationship_id: f.relationshipId, type, planned_minutes: 25, idempotency_key: `start_${type}` });
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const path = `/buddy/joint-activities/${created.body.data.id}`;
  assert.equal((await request(f.app, f.bob, "POST", `${path}/accept`)).statusCode, 200);
  for (const token of [f.alice, f.bob]) {
    assert.equal((await request(f.app, token, "POST", `${path}/start`)).statusCode, 200);
  }
  return String(created.body.data.id);
}

async function sleepSession(f: Awaited<ReturnType<typeof fixture>>) {
  const created = await request(f.app, f.alice, "POST", "/sleep-buddy/shared-sessions", {
    relationship_id: f.relationshipId, date_anchor: new Date().toISOString().slice(0, 10) });
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const id = String(created.body.data.session_id);
  assert.equal((await request(f.app, f.bob, "POST", `/sleep-buddy/shared-sessions/${id}/accept`)).statusCode, 200);
  return id;
}

test("one morning completion and a paused partner cannot complete tonight together", async () => {
  const f = await fixture("sleep");
  const goal = await activeGoal(f, "sleep_schedule_days");
  const activityId = await startedActivity(f, "tonight_together");
  const sessionId = await sleepSession(f);
  for (const [token, event] of [[f.alice, "morning_completed"], [f.bob, "paused_tonight"]]) {
    const result = await request(f.app, token, "POST", `/sleep-buddy/shared-sessions/${sessionId}/events`, { event_type: event });
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  }
  assert.equal((await activityFromFeed(f.app, f.alice, activityId)).status, "accepted");
  const listed = await request(f.app, f.bob, "GET", "/buddy/goals");
  const actual = listed.body.data.goals.find((item: any) => item.id === goal.id);
  assert.equal(actual.participant_progress.user_alice, 1);
  assert.equal(actual.participant_progress.user_bob, 0);
  assert.equal(actual.status, "active");
});

test("two individual morning completions complete sleep activity and count one day despite retries", async () => {
  const f = await fixture("sleep");
  const goal = await activeGoal(f, "sleep_schedule_days");
  const activityId = await startedActivity(f, "tonight_together");
  const sessionId = await sleepSession(f);
  for (const token of [f.alice, f.bob]) {
    for (let retry = 0; retry < 2; retry += 1) {
      const result = await request(f.app, token, "POST", `/sleep-buddy/shared-sessions/${sessionId}/events`,
        { event_type: "morning_completed" });
      assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    }
  }
  assert.equal((await activityFromFeed(f.app, f.bob, activityId)).status, "completed");
  await assertCompletedGoal(f.app, f.alice, goal.id, 1);
});

test("relationship domain constrains joint activities and goals", async () => {
  const f = await fixture("sleep");
  const activity = await request(f.app, f.alice, "POST", "/buddy/joint-activities", {
    relationship_id: f.relationshipId, type: "joint_focus", planned_minutes: 25, idempotency_key: "wrong_domain_activity" });
  assert.equal(activity.statusCode, 400);
  const goal = await request(f.app, f.alice, "POST", "/buddy/goals", {
    relationship_id: f.relationshipId, type: "focus_minutes", target: 25, timezone: "UTC", idempotency_key: "wrong_domain_goal" });
  assert.equal(goal.statusCode, 400);
});

test("cancelled activities stay cancelled after real sessions arrive", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-12T12:00:00.000Z") });
  const f = await fixture("focus");
  const id = await startedActivity(f, "joint_focus");
  const cancelled = await request(f.app, f.alice, "POST", `/buddy/joint-activities/${id}/cancel`);
  assert.equal(cancelled.statusCode, 200);
  const startedAt = new Date().toISOString();
  context.mock.timers.tick(25 * 60_000);
  await renewTokens(f);
  await uploadTwice(f.app, f.alice, "cancelled_alice", startedAt, new Date().toISOString());
  await uploadTwice(f.app, f.bob, "cancelled_bob", startedAt, new Date().toISOString());
  assert.equal((await activityFromFeed(f.app, f.bob, id)).status, "cancelled");
  const restarted = await request(f.app, f.bob, "POST", `/buddy/joint-activities/${id}/start`);
  assert.equal(restarted.statusCode, 409);
});

test("goal adjustments cannot switch to the other relationship domain", async () => {
  const f = await fixture("sleep");
  const goal = await activeGoal(f, "sleep_schedule_days");
  const adjusted = await request(f.app, f.alice, "POST", `/buddy/goals/${goal.id}/adjust`, {
    type: "focus_days", target: 1, expected_version: goal.version, idempotency_key: "wrong_domain_adjustment" });
  assert.equal(adjusted.statusCode, 400);
});

test("revoking shared activity consent denies goal and activity access immediately", async () => {
  const f = await fixture("focus");
  await activeGoal(f);
  const activityId = await startedActivity(f, "joint_focus");
  const grants = await request(f.app, f.alice, "GET", `/buddy/relationships/${f.relationshipId}/grants`);
  const grant = grants.body.data.grants.find((item: any) => item.grantor_user_id === "user_alice" &&
    item.grantee_user_id === "user_bob" && item.category === "shared_activity");
  assert.ok(grant);
  const revoked = await request(f.app, f.alice, "PATCH", `/buddy/relationships/${f.relationshipId}/grants/${grant.id}`,
    { expected_version: grant.version, state: "revoked" });
  assert.equal(revoked.statusCode, 200, JSON.stringify(revoked.body));
  const goals = await request(f.app, f.bob, "GET", "/buddy/goals");
  assert.equal(goals.statusCode, 200);
  assert.deepEqual(goals.body.data.goals, [], "revoked goals must be omitted from collections");
  assert.equal((await request(f.app, f.bob, "POST", `/buddy/joint-activities/${activityId}/start`)).statusCode, 403);
});


test("concurrent commands enforce goal versions after acquiring relationship slots", async () => {
  const f = await fixture("focus"); const goal = await activeGoal(f, "focus_days", 2);
  const results = await Promise.all([
    request(f.app, f.alice, "POST", `/buddy/goals/${goal.id}/pause`,
      { expected_version: goal.version, idempotency_key: "race_pause" }),
    request(f.app, f.bob, "POST", `/buddy/goals/${goal.id}/adjust`,
      { expected_version: goal.version, target: 3, idempotency_key: "race_adjust" }),
  ]);
  assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 409]);
});

test("concurrent goal creation retries persist one proposal and one notification", async () => {
  const f = await fixture("focus");
  const body = { relationship_id: f.relationshipId, type: "focus_days", target: 2,
    timezone: "UTC", idempotency_key: "concurrent_create" };
  const results = await Promise.all(Array.from({ length: 3 }, () => request(f.app, f.alice, "POST", "/buddy/goals", body)));
  assert.ok(results.every(result => result.statusCode === 200));
  assert.equal(new Set(results.map(result => result.body.data.id)).size, 1);
  assert.equal(f.app.database.frogSleepBuddyNotificationOutbox.filter(item => item.targetType === "buddy_joint_goal").length, 1);
});

test("joint activity rechecks sharing authorization inside the relationship transaction", async () => {
  const f = await fixture("focus"); const activityId = await startedActivity(f, "joint_focus");
  const grants = await f.app.database.listFrogSleepBuddySharingGrants("frogsleep", f.relationshipId);
  const grant = grants.find(item => item.grantorUserId === "user_alice" && item.granteeUserId === "user_bob" && item.category === "shared_activity")!;
  const database = f.app.database;
  const transaction = database.withFrogSleepBuddyCommandTransaction.bind(database);
  let revoked = false;
  database.withFrogSleepBuddyCommandTransaction = async (keys, operation) => transaction(keys, async () => {
    if (!revoked) {
      revoked = true;
      await database.updateFrogSleepBuddySharingGrant("frogsleep", grant.id, grant.version, "revoked");
    }
    return await operation();
  });
  const result = await request(f.app, f.bob, "POST", `/buddy/joint-activities/${activityId}/start`);
  assert.equal(result.statusCode, 403);
  assert.equal(revoked, true, "activity commands must acquire participant/domain slots");
});

test("expired accepted activities reject a fresh start", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-12T12:00:00.000Z") });
  const f = await fixture("focus");
  const created = await request(f.app, f.alice, "POST", "/buddy/joint-activities", {
    relationship_id: f.relationshipId, type: "joint_focus", planned_minutes: 25, idempotency_key: "expired_activity" });
  assert.equal(created.statusCode, 200);
  const path = `/buddy/joint-activities/${created.body.data.id}`;
  assert.equal((await request(f.app, f.bob, "POST", `${path}/accept`)).statusCode, 200);
  context.mock.timers.tick(37 * 3600_000);
  await renewTokens(f);
  assert.equal((await request(f.app, f.alice, "POST", `${path}/start`)).statusCode, 409);
  assert.equal((await activityFromFeed(f.app, f.bob, created.body.data.id)).status, "expired");
});

test("sleep partner can start the activity after the creator opened their shared session", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-12T22:00:00.000Z") });
  const f = await fixture("sleep");
  const created = await request(f.app, f.alice, "POST", "/buddy/joint-activities", {
    relationship_id: f.relationshipId, type: "tonight_together", idempotency_key: "asymmetric_sleep_start" });
  assert.equal(created.statusCode, 200);
  const activityId = String(created.body.data.id), path = `/buddy/joint-activities/${activityId}`;
  assert.equal((await request(f.app, f.bob, "POST", `${path}/accept`)).statusCode, 200);
  assert.equal((await request(f.app, f.alice, "POST", `${path}/start`)).statusCode, 200);
  const shared = await request(f.app, f.alice, "POST", "/sleep-buddy/shared-sessions", { relationship_id: f.relationshipId });
  assert.equal(shared.statusCode, 200);
  context.mock.timers.tick(60_000);
  assert.equal((await request(f.app, f.bob, "POST", `${path}/start`)).statusCode, 200);
  const sessionPath = `/sleep-buddy/shared-sessions/${shared.body.data.session_id}`;
  assert.equal((await request(f.app, f.bob, "POST", `${sessionPath}/accept`)).statusCode, 200);
  for (const token of [f.alice, f.bob]) {
    assert.equal((await request(f.app, token, "POST", `${sessionPath}/events`, { event_type: "morning_completed" })).statusCode, 200);
  }
  assert.equal((await activityFromFeed(f.app, f.bob, activityId)).status, "completed");
});

test("a stale goal version cannot overwrite a partner adjustment", async () => {
  const f = await fixture("focus");
  const goal = await activeGoal(f, "focus_days", 2);
  const adjusted = await request(f.app, f.alice, "POST", `/buddy/goals/${goal.id}/adjust`, {
    target: 3, expected_version: goal.version, idempotency_key: "first_adjustment" });
  assert.equal(adjusted.statusCode, 200);
  const stale = await request(f.app, f.bob, "POST", `/buddy/goals/${goal.id}/adjust`, {
    target: 4, expected_version: goal.version, idempotency_key: "stale_adjustment" });
  assert.equal(stale.statusCode, 409);
  const listed = await request(f.app, f.bob, "GET", "/buddy/goals");
  assert.equal(listed.body.data.goals.find((item: any) => item.id === goal.id).target, 3);
});

test("concurrent goal adjustments using the same version permit only one mutation", async () => {
  const f = await fixture("focus");
  const goal = await activeGoal(f, "focus_days", 2);
  const responses = await Promise.all([
    request(f.app, f.alice, "POST", `/buddy/goals/${goal.id}/adjust`, {
      target: 3, expected_version: goal.version, idempotency_key: "concurrent_alice" }),
    request(f.app, f.bob, "POST", `/buddy/goals/${goal.id}/adjust`, {
      target: 4, expected_version: goal.version, idempotency_key: "concurrent_bob" }),
  ]);
  assert.deepEqual(responses.map(result => result.statusCode).sort(), [200, 409]);
});

test("pausing a relationship preserves personal upload while withholding shared goals", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-12T12:00:00.000Z") });
  const f = await fixture("focus");
  await activeGoal(f, "focus_minutes", 25);
  await startedActivity(f, "joint_focus");
  const current = await f.app.database.findFrogSleepBuddyDomainRelationship("frogsleep", f.relationshipId);
  assert.ok(current);
  const paused = await f.app.database.compareAndUpdateFrogSleepBuddyDomainRelationship({
    appId: "frogsleep", id: current.id, expectedVersion: current.version, status: "paused",
    pausedByUserIds: ["user_alice"], updatedAt: new Date().toISOString() });
  assert.equal(paused?.status, "paused");
  const startedAt = new Date().toISOString();
  context.mock.timers.tick(25 * 60_000);
  await renewTokens(f);
  await uploadTwice(f.app, f.alice, "personal_after_pause", startedAt, new Date().toISOString());
  const hidden = await request(f.app, f.bob, "GET", "/buddy/goals");
  assert.equal(hidden.statusCode, 200);
  assert.deepEqual(hidden.body.data.goals, []);
});

test("the existing focus revoke command operates the canonical relationship", async () => {
  const f = await fixture("focus");
  await activeGoal(f);
  const revoked = await request(f.app, f.alice, "POST", `/focus-buddy/relationships/${f.relationshipId}/revoke`);
  assert.equal(revoked.statusCode, 200, JSON.stringify(revoked.body));
  const stored = await f.app.database.findFrogSleepBuddyDomainRelationship("frogsleep", f.relationshipId);
  assert.equal(stored?.status, "revoked");
  const hidden = await request(f.app, f.bob, "GET", "/buddy/goals");
  assert.equal(hidden.statusCode, 200);
  assert.deepEqual(hidden.body.data.goals, []);
});

test("verified focus minutes are bounded by elapsed time and exclude future or interrupted sessions", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-12T12:00:00.000Z") });
  const f = await fixture("focus");
  const goal = await activeGoal(f, "focus_minutes", 100);
  const startedAt = new Date().toISOString();
  context.mock.timers.tick(5 * 60_000);
  const cases = [
    { session_id: "overstated_minutes", status: "completed", ended_at: new Date().toISOString(), actual_minutes: 999 },
    { session_id: "future_finish", status: "completed", ended_at: new Date(Date.now() + 60 * 60_000).toISOString(), actual_minutes: 60 },
    { session_id: "interrupted_session", status: "interrupted", ended_at: new Date().toISOString(), actual_minutes: 5 },
  ];
  for (const input of cases) {
    const uploaded = await request(f.app, f.alice, "POST", "/focus-buddy/sessions", {
      ...input, started_at: startedAt, planned_minutes: 25, room: "reading", goal: "25m" });
    assert.equal(uploaded.statusCode, 200, JSON.stringify(uploaded.body));
  }
  const listed = await request(f.app, f.alice, "GET", "/buddy/goals");
  const actual = listed.body.data.goals.find((item: any) => item.id === goal.id);
  assert.equal(actual.participant_progress.user_alice, 5);
  assert.equal(actual.participant_progress.user_bob, 0);
  assert.equal(actual.status, "active");
});
