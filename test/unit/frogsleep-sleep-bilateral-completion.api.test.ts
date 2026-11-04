import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { enableFrogSleepBuddyCapabilities } from "../helpers/enable-frogsleep-buddy-capabilities.ts";
import { completionFacts } from "../../src/modules/frogsleep/buddy-growth/buddy-completion-facts.ts";

enableFrogSleepBuddyCapabilities();
type Runtime = Awaited<ReturnType<typeof createApplication>>;
type Fixture = { app: Runtime; alice: string; bob: string; activityId: string; sessionId: string };

async function request(app: Runtime, token: string, method: string, path: string, body?: unknown) {
  return await app.app.handle({ method, path: `/api/v1/frogsleep${path}`, body,
    headers: { authorization: `Bearer ${token}` }, requestId: "bilateral_sleep" } as never);
}

async function fixture(): Promise<Fixture> {
  const app = await createApplication({ frogsleepEnabled: true, queueBackend: "memory",
    databaseFactory: seed => new InMemoryDatabase(seed) });
  const now = new Date().toISOString(), relationshipId = "bilateral_sleep_relationship";
  await app.database.insertFrogSleepEntity({ id: relationshipId, appId: "frogsleep", kind: "sleep_relationship",
    ownerUserId: "user_alice", partnerUserId: "user_bob", status: "active", payload: {}, createdAt: now, updatedAt: now });
  for (const id of ["user_alice", "user_bob"]) await app.services.appRegistryService.ensureMembership("frogsleep", id);
  const alice = (await app.services.authService.issueSession("user_alice", "frogsleep")).accessToken;
  const bob = (await app.services.authService.issueSession("user_bob", "frogsleep")).accessToken;
  const activity = await request(app, alice, "POST", "/buddy/joint-activities", {
    relationship_id: relationshipId, type: "tonight_together", idempotency_key: "bilateral_sleep_activity" });
  assert.equal(activity.statusCode, 200, JSON.stringify(activity.body));
  const activityId = String(activity.body.data.id), activityPath = `/buddy/joint-activities/${activityId}`;
  assert.equal((await request(app, bob, "POST", `${activityPath}/accept`)).statusCode, 200);
  for (const token of [alice, bob]) assert.equal((await request(app, token, "POST", `${activityPath}/start`)).statusCode, 200);
  const shared = await request(app, alice, "POST", "/sleep-buddy/shared-sessions", { relationship_id: relationshipId });
  assert.equal(shared.statusCode, 200, JSON.stringify(shared.body));
  const sessionId = String(shared.body.data.session_id);
  for (const token of [alice, bob]) assert.equal((await request(app, token, "POST", `/sleep-buddy/shared-sessions/${sessionId}/accept`)).statusCode, 200);
  return { app, alice, bob, activityId, sessionId };
}

async function morning(f: Fixture, token: string) {
  const response = await request(f.app, token, "POST", `/sleep-buddy/shared-sessions/${f.sessionId}/events`,
    { event_type: "morning_completed" });
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  return response.body.data;
}

async function summary(f: Fixture, token: string) {
  const response = await request(f.app, token, "GET", "/sleep-buddy/shared-summaries/latest");
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.ok(response.body.data.summary);
  return response.body.data.summary;
}

test("one completed morning keeps the shared session recoverable by the unfinished partner", async () => {
  const f = await fixture();
  const completed = await morning(f, f.alice);
  assert.equal(completed.status, "active", "the shared session stays active until both participants reach a terminal state");
  const restored = await request(f.app, f.bob, "GET", "/sleep-buddy/shared-sessions/active");
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.body.data.session?.session_id, f.sessionId);
  assert.equal(restored.body.data.session.participant_states.user_alice, "morning_completed");
  assert.equal(restored.body.data.session.participant_states.user_bob, "accepted");
});

test("one partner's morning cannot produce a completed morning or both-completed recap for the other", async () => {
  const f = await fixture();
  await morning(f, f.alice);
  const alice = await summary(f, f.alice), bob = await summary(f, f.bob);
  assert.equal(alice.completed_morning, true);
  assert.equal(bob.completed_morning, false);
  assert.notEqual(bob.visible_state, "morning_completed");
  assert.equal(bob.completed, false, "legacy completed must be scoped to the summary owner");
  const recap = await request(f.app, f.bob, "GET", "/sleep-buddy/shared-recaps/latest");
  assert.equal(recap.statusCode, 200, JSON.stringify(recap.body));
  assert.notEqual(recap.body.data.recap.combined_result_type, "both_completed");
});

test("both individual mornings produce a final completed session and joint result", async () => {
  const f = await fixture();
  await morning(f, f.alice);
  const result = await morning(f, f.bob);
  assert.equal(result.status, "completed");
  const recap = await request(f.app, f.alice, "GET", "/sleep-buddy/shared-recaps/latest");
  assert.equal(recap.statusCode, 200, JSON.stringify(recap.body));
  assert.equal(recap.body.data.recap.combined_result_type, "both_completed");
  assert.equal((await summary(f, f.alice)).completed_morning, true);
  assert.equal((await summary(f, f.bob)).completed_morning, true);
  const activity = await request(f.app, f.bob, "GET", "/buddy/activity");
  assert.equal(activity.body.data.items.find((item: any) => item.id === f.activityId).status, "completed");
  const active = await request(f.app, f.bob, "GET", "/sleep-buddy/shared-sessions/active");
  assert.equal(active.body.data.session, null);
});

test("replayed accept preserves an individual's completed morning while their partner is unfinished", async () => {
  const f = await fixture();
  await morning(f, f.alice);
  const replay = await request(f.app, f.alice, "POST", `/sleep-buddy/shared-sessions/${f.sessionId}/accept`);
  assert.equal(replay.statusCode, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.data.participant_states.user_alice, "morning_completed");
  assert.equal(replay.body.data.status, "active");
});

test("replayed accept cannot reopen a bilaterally completed shared session", async () => {
  const f = await fixture();
  await morning(f, f.alice);
  await morning(f, f.bob);
  const replay = await request(f.app, f.alice, "POST", `/sleep-buddy/shared-sessions/${f.sessionId}/accept`);
  assert.equal(replay.statusCode, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.data.status, "completed");
  assert.equal(replay.body.data.participant_states.user_alice, "morning_completed");
});

test("late recovery events cannot erase a persisted completed morning", async () => {
  const f = await fixture();
  await morning(f, f.alice);
  for (const eventType of ["interrupted", "returned"]) {
    const replay = await request(f.app, f.alice, "POST", `/sleep-buddy/shared-sessions/${f.sessionId}/events`, {
      event_type: eventType, occurred_at: new Date(Date.now() - 60_000).toISOString() });
    assert.ok([200, 409].includes(replay.statusCode), JSON.stringify(replay.body));
  }
  const stored = await f.app.database.findFrogSleepEntity("sleep_session", "frogsleep", f.sessionId);
  assert.equal((stored?.payload.participantStates as Record<string, unknown>).user_alice, "morning_completed");
  assert.equal((await summary(f, f.alice)).completed_morning, true);
});

test("one participant pausing leaves their unfinished partner's session available", async () => {
  const f = await fixture();
  const paused = await request(f.app, f.alice, "POST", `/sleep-buddy/shared-sessions/${f.sessionId}/pause-tonight`);
  assert.equal(paused.statusCode, 200);
  assert.equal(paused.body.data.status, "active");
  assert.equal((await summary(f, f.bob)).paused_tonight, false);
  const completed = await morning(f, f.bob);
  assert.equal(completed.status, "completed");
  assert.equal((await summary(f, f.alice)).paused_tonight, true);
  assert.equal((await summary(f, f.bob)).completed_morning, true);
  assert.equal((await summary(f, f.bob)).paused_tonight, false);
  const recap = await request(f.app, f.bob, "GET", "/sleep-buddy/shared-recaps/latest");
  assert.equal(recap.body.data.recap.my_result_state, "completed");
  assert.equal(recap.body.data.recap.partner_result_state, "paused");
});

test("partner completion on a later date cannot move the first participant's verified morning", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-12T23:59:00.000Z") });
  const f = await fixture();
  const firstCompletedAt = new Date().toISOString();
  await morning(f, f.alice);
  context.mock.timers.tick(2 * 60_000);
  const partnerCompletedAt = new Date().toISOString();
  await morning(f, f.bob);
  const relationship = await f.app.database.findFrogSleepEntity("sleep_relationship", "frogsleep", "bilateral_sleep_relationship");
  assert.ok(relationship);
  const aliceFacts = await completionFacts(f.app.database, relationship, "user_alice");
  const bobFacts = await completionFacts(f.app.database, relationship, "user_bob");
  assert.equal(aliceFacts.find(fact => fact.kind === "sleep")?.occurredAt, firstCompletedAt);
  assert.equal(bobFacts.find(fact => fact.kind === "sleep")?.occurredAt, partnerCompletedAt);
});
