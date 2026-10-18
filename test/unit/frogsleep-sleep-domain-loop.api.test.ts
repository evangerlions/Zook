import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { enableFrogSleepBuddyCapabilities } from "../helpers/enable-frogsleep-buddy-capabilities.ts";

enableFrogSleepBuddyCapabilities();
const prefix = "/api/v1/frogsleep";
type Runtime = Awaited<ReturnType<typeof createApplication>>;

async function request(runtime: Runtime, token: string, method: string, path: string, body?: unknown) {
  return await runtime.app.handle({ method, path: `${prefix}${path}`, body,
    headers: { authorization: `Bearer ${token}` }, requestId: "sleep_domain_loop" } as never);
}

async function login(runtime: Runtime, account: string) {
  const response = await request(runtime, "", "POST", "/auth/password/login",
    { account, password: "Password1234" });
  assert.equal(response.statusCode, 200);
  return String(response.body.data.access_token);
}

async function acceptedRelationship(runtime: Runtime, alice: string, bob: string) {
  const invitation = await request(runtime, alice, "POST", "/buddy/invitations",
    { target: { email: "bob@example.com" }, domains: ["sleep"] });
  assert.equal(invitation.statusCode, 200);
  const id = String(invitation.body.data.invitation_id);
  const accepted = await request(runtime, bob, "POST", `/buddy/invitations/${id}/domains/sleep/accept`,
    { expected_version: 1, idempotency_key: "sleep-runtime-loop" });
  assert.equal(accepted.statusCode, 200);
  return String(accepted.body.data.relationship_id);
}

async function authorize(runtime: Runtime, token: string, relationshipId: string, owner: string) {
  const listed = await request(runtime, token, "GET", `/buddy/relationships/${relationshipId}/grants`);
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.body.data.grants.length, 8);
  for (const grant of listed.body.data.grants.filter((item: { grantor_user_id: string }) => item.grantor_user_id === owner)) {
    assert.equal(grant.state, "revoked");
    const updated = await request(runtime, token, "PATCH", `/buddy/relationships/${relationshipId}/grants/${grant.id}`,
      { expected_version: grant.version, state: "granted" });
    assert.equal(updated.statusCode, 200);
  }
}

async function morningLoop(runtime: Runtime, alice: string, bob: string, id: string) {
  const started = await request(runtime, alice, "POST", "/sleep-buddy/shared-sessions",
    { relationship_id: id, date_anchor: "2026-10-18" });
  assert.equal(started.statusCode, 200);
  const sessionId = String(started.body.data.session_id);
  assert.equal((await request(runtime, bob, "POST", `/sleep-buddy/shared-sessions/${sessionId}/accept`)).statusCode, 200);
  for (const event of ["interrupted", "returned", "morning_completed"]) {
    const response = await request(runtime, alice, "POST", `/sleep-buddy/shared-sessions/${sessionId}/events`, { event_type: event });
    assert.equal(response.statusCode, 200);
  }
  const summary = await request(runtime, bob, "GET", "/sleep-buddy/shared-summaries/latest");
  assert.equal(summary.statusCode, 200);
  assert.equal(summary.body.data.summary.relationship_id, id);
  assert.equal(summary.body.data.summary.date_anchor, "2026-10-18");
  return sessionId;
}

test("new sleep invitation flows through explicit grants, session, morning result and bilateral lifecycle", async () => {
  const runtime = await createApplication({ frogsleepEnabled: true, queueBackend: "memory",
    databaseFactory: seed => new InMemoryDatabase(seed) });
  const alice = await login(runtime, "alice@example.com"), bob = await login(runtime, "bob@example.com");
  const id = await acceptedRelationship(runtime, alice, bob);
  const current = await request(runtime, alice, "GET", "/sleep-buddy/relationships/current");
  assert.equal(current.body.data.relationship.relationship_id, id);
  assert.equal((await request(runtime, alice, "POST", "/sleep-buddy/shared-sessions", { relationship_id: id })).statusCode, 403);
  await authorize(runtime, alice, id, "user_alice");
  await authorize(runtime, bob, id, "user_bob");
  const sessionId = await morningLoop(runtime, alice, bob, id);
  await lifecycle(runtime, alice, bob, id, sessionId);
});

async function lifecycle(runtime: Runtime, alice: string, bob: string, id: string, sessionId: string) {
  const action = (token: string, verb: string) => request(runtime, token, "POST", `/sleep-buddy/relationships/${id}/${verb}`);
  assert.equal((await action(alice, "pause")).body.data.relationship.status, "paused");
  assert.equal((await action(bob, "pause")).body.data.relationship.status, "paused");
  assert.equal((await action(alice, "resume")).body.data.relationship.status, "paused");
  assert.equal((await request(runtime, bob, "GET", "/sleep-buddy/shared-summaries/latest")).body.data.summary, null);
  assert.equal((await action(bob, "resume")).body.data.relationship.status, "active");
  assert.equal((await action(alice, "revoke")).body.data.relationship.status, "revoked");
  assert.equal((await request(runtime, bob, "POST", `/sleep-buddy/shared-sessions/${sessionId}/events`, { event_type: "returned" })).statusCode, 403);
  for (const userId of ["user_alice", "user_bob"]) {
    const slot = await runtime.database.findFrogSleepBuddyDomainSlot("frogsleep", userId, "sleep");
    assert.equal(slot?.state, "available");
  }
}

test("accepted sleep relationship remains discoverable before sharing is enabled", async () => {
  const runtime = await createApplication({ frogsleepEnabled: true, queueBackend: "memory",
    databaseFactory: seed => new InMemoryDatabase(seed) });
  const alice = await login(runtime, "alice@example.com"), bob = await login(runtime, "bob@example.com");
  const id = await acceptedRelationship(runtime, alice, bob);
  const status = await request(runtime, bob, "GET", "/sleep-buddy/guardianship/status");
  assert.equal(status.statusCode, 200);
  assert.equal(status.body.data.current_relationship.relationship_id, id);
  assert.equal(status.body.data.active_session, null);
  assert.equal(status.body.data.latest_summary, null);
  assert.equal((await request(runtime, alice, "POST", "/sleep-buddy/shared-sessions", { relationship_id: id })).statusCode, 403);
});
