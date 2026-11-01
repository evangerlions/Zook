import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { FrogSleepSleepBuddyService } from "../../src/modules/frogsleep/sleep-buddy/sleep-buddy.service.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { enableFrogSleepBuddyCapabilities } from "../helpers/enable-frogsleep-buddy-capabilities.ts";

enableFrogSleepBuddyCapabilities();
type Runtime = Awaited<ReturnType<typeof createApplication>>;
type Fixture = { app: Runtime; alice: string; bob: string; charlie: string; activityId: string };
const relationshipId = "sleep_activity_relationship";

async function request(app: Runtime, token: string, method: string, path: string, body?: unknown) {
  return await app.app.handle({ method, path: `/api/v1/frogsleep${path}`, body,
    headers: { authorization: `Bearer ${token}` }, requestId: "sleep_activity_link" } as never);
}

async function fixture(startParticipants = true): Promise<Fixture> {
  const app = await createApplication({ frogsleepEnabled: true, queueBackend: "memory",
    databaseFactory: seed => new InMemoryDatabase(seed) });
  const now = new Date().toISOString();
  await app.database.insertUser({ id: "user_charlie", email: "sleep_link_charlie@example.test", passwordHash: "unused",
    passwordAlgo: "test", status: "ACTIVE", createdAt: now });
  await app.database.insertFrogSleepEntity({ id: relationshipId, appId: "frogsleep", kind: "sleep_relationship",
    ownerUserId: "user_alice", partnerUserId: "user_bob", status: "active", payload: {}, createdAt: now, updatedAt: now });
  const tokens: string[] = [];
  for (const id of ["user_alice", "user_bob", "user_charlie"]) {
    await app.services.appRegistryService.ensureMembership("frogsleep", id);
    tokens.push((await app.services.authService.issueSession(id, "frogsleep")).accessToken);
  }
  const [alice, bob, charlie] = tokens;
  const created = await request(app, alice, "POST", "/buddy/joint-activities", {
    relationship_id: relationshipId, type: "tonight_together", idempotency_key: "linked_sleep_activity" });
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const activityId = String(created.body.data.id), path = `/buddy/joint-activities/${activityId}`;
  assert.equal((await request(app, bob, "POST", `${path}/accept`)).statusCode, 200);
  if (startParticipants) {
    for (const token of [alice, bob]) assert.equal((await request(app, token, "POST", `${path}/start`)).statusCode, 200);
  }
  return { app, alice, bob, charlie, activityId };
}

async function begin(f: Fixture, token: string, dateAnchor: string, id: string | undefined = f.activityId, relation = relationshipId) {
  return await request(f.app, token, "POST", "/sleep-buddy/shared-sessions", {
    relationship_id: relation, date_anchor: dateAnchor, ...(id ? { joint_activity_id: id } : {}) });
}

async function sessions(f: Fixture) {
  return await f.app.database.listFrogSleepEntities({ appId: "frogsleep", kind: "sleep_session", limit: 100 });
}

async function completeSleep(f: Fixture, sessionId: string, tokens = [f.alice, f.bob]) {
  const path = `/sleep-buddy/shared-sessions/${sessionId}`;
  for (const token of tokens) {
    assert.equal((await request(f.app, token, "POST", `${path}/accept`)).statusCode, 200);
    assert.equal((await request(f.app, token, "POST", `${path}/events`, { event_type: "morning_completed" })).statusCode, 200);
  }
}

async function readActivity(f: Fixture) {
  const response = await request(f.app, f.bob, "GET", "/buddy/activity");
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  return response.body.data.items.find((item: any) => item.id === f.activityId);
}

test("one sleep activity keeps the same session across service and HTTP callers with different date anchors", async () => {
  const f = await fixture();
  const service = new FrogSleepSleepBuddyService(f.app.database);
  const first = await service.beginSession("user_alice", relationshipId, "2026-10-18", f.activityId);
  const otherTimezone = await begin(f, f.bob, "2026-10-19");
  assert.equal(otherTimezone.statusCode, 200, JSON.stringify(otherTimezone.body));
  assert.equal(otherTimezone.body.data.session_id, first.session_id);
  const restored = await service.beginSession("user_alice", relationshipId, "2026-10-20", f.activityId);
  assert.equal(restored.session_id, first.session_id);
  assert.equal((await sessions(f)).length, 1);
});

test("HTTP retries retain the activity session instead of creating another session after midnight", async () => {
  const f = await fixture();
  const first = await begin(f, f.alice, "2026-10-18");
  assert.equal(first.statusCode, 200);
  const second = await begin(f, f.bob, "2026-10-19");
  assert.equal(second.statusCode, 200);
  const retry = await begin(f, f.alice, "2026-10-19");
  assert.equal(retry.statusCode, 200);
  assert.equal(second.body.data.session_id, first.body.data.session_id);
  assert.equal(retry.body.data.session_id, first.body.data.session_id);
  assert.equal((await sessions(f)).length, 1);
});

test("recovering a finished activity returns its original session without opening a second night", async () => {
  const f = await fixture();
  const first = await begin(f, f.alice, "2026-10-18");
  assert.equal(first.statusCode, 200);
  const path = `/sleep-buddy/shared-sessions/${first.body.data.session_id}`;
  for (const token of [f.alice, f.bob]) {
    assert.equal((await request(f.app, token, "POST", `${path}/accept`)).statusCode, 200);
    assert.equal((await request(f.app, token, "POST", `${path}/events`, { event_type: "morning_completed" })).statusCode, 200);
  }
  const activity = await request(f.app, f.bob, "GET", "/buddy/activity");
  assert.equal(activity.body.data.items.find((item: any) => item.id === f.activityId).status, "completed");
  const restored = await begin(f, f.bob, "2026-10-19");
  assert.equal(restored.statusCode, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.data.session_id, first.body.data.session_id);
  assert.equal(restored.body.data.status, "completed");
  assert.equal((await sessions(f)).length, 1);
});

test("a mismatched relationship cannot use another relationship's accepted sleep activity", async () => {
  const f = await fixture(), now = new Date().toISOString();
  await f.app.database.insertFrogSleepEntity({ id: "other_sleep_relationship", appId: "frogsleep", kind: "sleep_relationship",
    ownerUserId: "user_alice", partnerUserId: "user_charlie", status: "active", payload: {}, createdAt: now, updatedAt: now });
  const response = await begin(f, f.alice, "2026-10-18", f.activityId, "other_sleep_relationship");
  assert.equal(response.statusCode, 403, JSON.stringify(response.body));
  assert.equal((await sessions(f)).length, 0);
});

test("a nonparticipant cannot create a session linked to the accepted activity", async () => {
  const f = await fixture();
  const response = await begin(f, f.charlie, "2026-10-18");
  assert.equal(response.statusCode, 403, JSON.stringify(response.body));
  assert.equal((await sessions(f)).length, 0);
});

test("a cancelled activity cannot create its first shared sleep session", async () => {
  const f = await fixture();
  const cancelled = await request(f.app, f.alice, "POST", `/buddy/joint-activities/${f.activityId}/cancel`);
  assert.equal(cancelled.statusCode, 200);
  const response = await begin(f, f.alice, "2026-10-18");
  assert.equal(response.statusCode, 409, JSON.stringify(response.body));
  assert.equal((await sessions(f)).length, 0);
});

test("without an activity link legacy callers keep their date-anchor deduplication", async () => {
  const f = await fixture();
  const first = await begin(f, f.alice, "2026-10-18", "");
  const sameDate = await begin(f, f.bob, "2026-10-18", "");
  const nextDate = await begin(f, f.bob, "2026-10-19", "");
  for (const response of [first, sameDate, nextDate]) assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.equal(sameDate.body.data.session_id, first.body.data.session_id);
  assert.notEqual(nextDate.body.data.session_id, first.body.data.session_id);
  assert.equal((await sessions(f)).length, 2);
});

test("accepted activity without the participant's start cannot create a linked sleep session", async () => {
  const f = await fixture(false);
  const response = await begin(f, f.alice, "2026-10-18");
  assert.equal(response.statusCode, 409, JSON.stringify(response.body));
  assert.equal((await sessions(f)).length, 0);
});

test("another completed shared session cannot replace the session bound to the activity", async () => {
  const f = await fixture();
  const linked = await begin(f, f.alice, "2026-10-18");
  assert.equal(linked.statusCode, 200, JSON.stringify(linked.body));
  const linkedId = String(linked.body.data.session_id);
  const other = await begin(f, f.alice, "2026-10-19", "");
  assert.equal(other.statusCode, 200, JSON.stringify(other.body));
  const otherId = String(other.body.data.session_id);
  assert.notEqual(linkedId, otherId);
  await completeSleep(f, otherId);
  assert.equal((await readActivity(f)).status, "accepted", "unrelated sleep facts cannot manufacture activity completion");
  const restored = await begin(f, f.bob, "2026-10-19");
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.body.data.session_id, linkedId);
  await completeSleep(f, linkedId, [f.alice]);
  assert.equal((await readActivity(f)).status, "accepted");
  await completeSleep(f, linkedId, [f.bob]);
  assert.equal((await readActivity(f)).status, "completed");
  assert.equal((await sessions(f)).length, 2);
});

test("an expired started activity without an existing session cannot open a night", async () => {
  const f = await fixture();
  const activity = await f.app.database.findFrogSleepEntity("buddy_joint_activity", "frogsleep", f.activityId);
  await f.app.database.updateFrogSleepEntity("buddy_joint_activity", "frogsleep", f.activityId, {
    payload: { ...activity!.payload, expires_at: "2000-01-01T00:00:00.000Z" } });
  const response = await begin(f, f.alice, "2026-10-18");
  assert.equal(response.statusCode, 409, JSON.stringify(response.body));
  assert.equal((await sessions(f)).length, 0);
});

test("revoking sharing prevents a participant from recovering an already linked session", async () => {
  const f = await fixture();
  const original = await begin(f, f.alice, "2026-10-18");
  assert.equal(original.statusCode, 200, JSON.stringify(original.body));
  const listed = await request(f.app, f.alice, "GET", `/buddy/relationships/${relationshipId}/grants`);
  assert.equal(listed.statusCode, 200, JSON.stringify(listed.body));
  const grant = listed.body.data.grants.find((item: any) => item.grantor_user_id === "user_alice" &&
    item.grantee_user_id === "user_bob" && item.category === "shared_activity");
  assert.ok(grant);
  const revoked = await request(f.app, f.alice, "PATCH", `/buddy/relationships/${relationshipId}/grants/${grant.id}`,
    { expected_version: grant.version, state: "revoked" });
  assert.equal(revoked.statusCode, 200, JSON.stringify(revoked.body));
  const recovered = await begin(f, f.bob, "2026-10-19");
  assert.equal(recovered.statusCode, 403, JSON.stringify(recovered.body));
  assert.equal((await sessions(f)).length, 1);
});
