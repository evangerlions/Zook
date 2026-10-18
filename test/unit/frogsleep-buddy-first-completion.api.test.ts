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
  assert.equal((await request(f.app, f.bob, "GET", "/buddy/goals")).statusCode, 403);
  assert.equal((await request(f.app, f.bob, "POST", `/buddy/joint-activities/${activityId}/start`)).statusCode, 403);
});
