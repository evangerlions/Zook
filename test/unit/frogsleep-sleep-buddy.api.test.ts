import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

async function createTestRuntime() {
  return await createApplication({
    frogsleepEnabled: true,
    queueBackend: "memory",
    databaseFactory: (seed) => new InMemoryDatabase(seed),
  });
}

async function login(runtime: Awaited<ReturnType<typeof createTestRuntime>>, account: string) {
  const response = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/password/login",
    headers: {},
    body: {
      account,
      password: "Password1234",
    },
    requestId: `req_login_${account}`,
  } as never);
  assert.equal(response.statusCode, 200);
  return String(response.body.data.access_token);
}

test("FrogSleep sleep buddy invite through morning recap flow", async () => {
  const runtime = await createTestRuntime();
  const aliceToken = await login(runtime, "alice@example.com");
  const bobToken = await login(runtime, "bob@example.com");

  const inviteResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/relationships/invites",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    body: {
      invitee: "user_bob",
      role: "guardian",
    },
    requestId: "req_sleep_invite",
  } as never);
  assert.equal(inviteResponse.statusCode, 200);
  assert.equal(inviteResponse.body.data.status, "pending");
  assert.equal(inviteResponse.body.status, "pending");
  assert.equal(typeof inviteResponse.body.data.share_link, "string");
  assert.equal(inviteResponse.body.share_link, inviteResponse.body.data.share_link);

  const acceptResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/relationships/invites/accept-code",
    headers: {
      authorization: `Bearer ${bobToken}`,
    },
    body: {
      code: inviteResponse.body.data.code,
    },
    requestId: "req_sleep_invite_accept",
  } as never);
  assert.equal(acceptResponse.statusCode, 200);
  assert.equal(acceptResponse.body.data.status, "active");
  const relationshipId = String(acceptResponse.body.data.relationship_id);

  const currentResponse = await runtime.app.handle({
    method: "GET",
    path: "/v1/relationships/current",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    requestId: "req_sleep_relationship_current",
  } as never);
  assert.equal(currentResponse.statusCode, 200);
  assert.equal(currentResponse.body.data.relationship.relationship_id, relationshipId);
  assert.equal(currentResponse.body.relationship_id, relationshipId);
  assert.equal(currentResponse.body.relationship.relationship_id, relationshipId);

  const preferenceResponse = await runtime.app.handle({
    method: "PATCH",
    path: `/v1/relationships/${relationshipId}/preferences`,
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    body: {
      guard_level: "strict",
      mute_for_tonight: true,
    },
    requestId: "req_sleep_preferences",
  } as never);
  assert.equal(preferenceResponse.statusCode, 200);
  assert.equal(preferenceResponse.body.data.preferences.guard_level, "strict");
  assert.equal(preferenceResponse.body.data.relationship.relationship_id, relationshipId);

  const sessionResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/shared-sessions",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    body: {
      relationship_id: relationshipId,
      date_anchor: "2026-04-01",
    },
    requestId: "req_sleep_session_begin",
  } as never);
  assert.equal(sessionResponse.statusCode, 200);
  const sessionId = String(sessionResponse.body.data.session_id);
  assert.equal(sessionResponse.body.data.shared_session_id, sessionId);
  assert.equal(sessionResponse.body.data.initiator_user_id, "user_alice");
  assert.equal(sessionResponse.body.data.invite_status, "pending");
  assert.equal(sessionResponse.body.data.initiator_state, "started");
  assert.equal(sessionResponse.body.data.partner_state, "invited");
  assert.equal(sessionResponse.body.data.date_anchor, "2026-04-01");

  const sessionAcceptResponse = await runtime.app.handle({
    method: "POST",
    path: `/v1/shared-sessions/${sessionId}/accept`,
    headers: {
      authorization: `Bearer ${bobToken}`,
    },
    requestId: "req_sleep_session_accept",
  } as never);
  assert.equal(sessionAcceptResponse.statusCode, 200);
  assert.equal(sessionAcceptResponse.body.data.status, "active");

  const eventResponse = await runtime.app.handle({
    method: "POST",
    path: `/v1/shared-sessions/${sessionId}/events`,
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    body: {
      event_type: "morning_completed",
      metadata: {
        score: 88,
      },
    },
    requestId: "req_sleep_session_event",
  } as never);
  assert.equal(eventResponse.statusCode, 200);
  assert.equal(eventResponse.body.data.status, "completed");

  const summaryResponse = await runtime.app.handle({
    method: "GET",
    path: "/v1/shared-summaries/latest",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    requestId: "req_sleep_latest_summary",
  } as never);
  assert.equal(summaryResponse.statusCode, 200);
  assert.equal(summaryResponse.body.data.summary.session_id, sessionId);
  assert.equal(summaryResponse.body.session_id, sessionId);
  assert.equal(summaryResponse.body.summary.session_id, sessionId);

  const recapResponse = await runtime.app.handle({
    method: "GET",
    path: "/v1/shared-recaps/latest",
    headers: {
      authorization: `Bearer ${bobToken}`,
    },
    requestId: "req_sleep_latest_recap",
  } as never);
  assert.equal(recapResponse.statusCode, 200);
  assert.equal(recapResponse.body.data.recap.session_id, sessionId);
  assert.equal(recapResponse.body.session_id, sessionId);
  assert.equal(recapResponse.body.recap.session_id, sessionId);
});

test("FrogSleep sleep buddy prevents duplicate active relationships and supports actions", async () => {
  const runtime = await createTestRuntime();
  const aliceToken = await login(runtime, "alice@example.com");
  const bobToken = await login(runtime, "bob@example.com");

  const inviteResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/relationships/invites",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    body: {
      invitee: "user_bob",
    },
    requestId: "req_sleep_invite_actions",
  } as never);
  const acceptResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/relationships/invites/accept-code",
    headers: {
      authorization: `Bearer ${bobToken}`,
    },
    body: {
      code: inviteResponse.body.data.code,
    },
    requestId: "req_sleep_invite_actions_accept",
  } as never);
  const relationshipId = String(acceptResponse.body.data.relationship_id);

  const duplicateInviteResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/relationships/invites",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    body: {
      invitee: "user_bob",
    },
    requestId: "req_sleep_duplicate_invite",
  } as never);
  assert.equal(duplicateInviteResponse.statusCode, 409);

  const pauseResponse = await runtime.app.handle({
    method: "POST",
    path: `/v1/relationships/${relationshipId}/pause`,
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    requestId: "req_sleep_relationship_pause",
  } as never);
  assert.equal(pauseResponse.statusCode, 200);
  assert.equal(pauseResponse.body.data.status, "paused");

  const resumeResponse = await runtime.app.handle({
    method: "POST",
    path: `/v1/relationships/${relationshipId}/resume`,
    headers: {
      authorization: `Bearer ${bobToken}`,
    },
    requestId: "req_sleep_relationship_resume",
  } as never);
  assert.equal(resumeResponse.statusCode, 200);
  assert.equal(resumeResponse.body.data.status, "active");

  const revokeResponse = await runtime.app.handle({
    method: "POST",
    path: `/v1/relationships/${relationshipId}/revoke`,
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    requestId: "req_sleep_relationship_revoke",
  } as never);
  assert.equal(revokeResponse.statusCode, 200);
  assert.equal(revokeResponse.body.data.status, "revoked");
});
