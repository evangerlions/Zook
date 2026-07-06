import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { FROGSLEEP_APP_ID } from "../../src/modules/frogsleep/frogsleep-app.ts";
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

async function createSleepRelationship(runtime: Awaited<ReturnType<typeof createTestRuntime>>) {
  const aliceToken = await login(runtime, "alice@example.com");
  const bobToken = await login(runtime, "bob@example.com");
  const inviteResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/relationships/invites",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { invitee: "user_bob" },
    requestId: "req_sleep_helper_invite",
  } as never);
  assert.equal(inviteResponse.statusCode, 200);
  const acceptResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/relationships/invites/accept-code",
    headers: { authorization: `Bearer ${bobToken}` },
    body: { code: inviteResponse.body.data.code },
    requestId: "req_sleep_helper_accept",
  } as never);
  assert.equal(acceptResponse.statusCode, 200);
  return {
    aliceToken,
    bobToken,
    relationshipId: String(acceptResponse.body.data.relationship_id),
  };
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
  assert.equal(summaryResponse.body.data.summary.artifact_version, "shared-session-v2");
  assert.equal(summaryResponse.body.data.summary.visible_state, "morning_completed");
  assert.equal(summaryResponse.body.data.summary.completed_morning, true);
  assert.equal(typeof summaryResponse.body.data.summary.headline, "string");

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
  assert.equal(recapResponse.body.data.recap.artifact_version, "shared-session-v2");
  assert.equal(typeof recapResponse.body.data.recap.combined_result_type, "string");
  assert.equal(typeof recapResponse.body.data.recap.my_result_state, "string");
  assert.equal(typeof recapResponse.body.data.recap.headline, "string");
  assert.equal(typeof recapResponse.body.data.recap.supporting_line, "string");
  assert.equal(typeof recapResponse.body.data.recap.recommended_next_step, "string");
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

test("FrogSleep sleep buddy treats revoked relationships as terminal", async () => {
  const runtime = await createTestRuntime();
  const { aliceToken, bobToken, relationshipId } = await createSleepRelationship(runtime);

  const revokeResponse = await runtime.app.handle({
    method: "POST",
    path: `/v1/relationships/${relationshipId}/revoke`,
    headers: { authorization: `Bearer ${aliceToken}` },
    requestId: "req_sleep_terminal_revoke",
  } as never);
  assert.equal(revokeResponse.statusCode, 200);

  const resumeResponse = await runtime.app.handle({
    method: "POST",
    path: `/v1/relationships/${relationshipId}/resume`,
    headers: { authorization: `Bearer ${bobToken}` },
    requestId: "req_sleep_terminal_resume",
  } as never);
  assert.equal(resumeResponse.statusCode, 409);

  const pauseResponse = await runtime.app.handle({
    method: "POST",
    path: `/v1/relationships/${relationshipId}/pause`,
    headers: { authorization: `Bearer ${aliceToken}` },
    requestId: "req_sleep_terminal_pause",
  } as never);
  assert.equal(pauseResponse.statusCode, 409);

  const beginResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/shared-sessions",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { relationship_id: relationshipId, date_anchor: "2026-04-02" },
    requestId: "req_sleep_terminal_begin",
  } as never);
  assert.equal(beginResponse.statusCode, 409);
});

test("FrogSleep shared sleep begin is idempotent for relationship and date anchor", async () => {
  const runtime = await createTestRuntime();
  const { aliceToken, relationshipId } = await createSleepRelationship(runtime);

  const first = await runtime.app.handle({
    method: "POST",
    path: "/v1/shared-sessions",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { relationship_id: relationshipId, date_anchor: "2026-04-03" },
    requestId: "req_sleep_idempotent_begin_first",
  } as never);
  assert.equal(first.statusCode, 200);

  const second = await runtime.app.handle({
    method: "POST",
    path: "/v1/shared-sessions",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { relationship_id: relationshipId, date_anchor: "2026-04-03" },
    requestId: "req_sleep_idempotent_begin_second",
  } as never);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.data.session_id, first.body.data.session_id);

  const sessions = runtime.database.listFrogSleepEntities({
    appId: FROGSLEEP_APP_ID,
    kind: "sleep_session",
    relationshipId,
    status: "pending",
  });
  assert.equal(sessions.length, 1);
});

test("FrogSleep sleep events reject unknown event types and invalid relationship targets", async () => {
  const runtime = await createTestRuntime();
  const { aliceToken, relationshipId } = await createSleepRelationship(runtime);
  const sessionResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/shared-sessions",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { relationship_id: relationshipId, date_anchor: "2026-04-04" },
    requestId: "req_sleep_event_validation_begin",
  } as never);
  assert.equal(sessionResponse.statusCode, 200);
  const sessionId = String(sessionResponse.body.data.session_id);

  const unknownEvent = await runtime.app.handle({
    method: "POST",
    path: `/v1/shared-sessions/${sessionId}/events`,
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { event_type: "teleport" },
    requestId: "req_sleep_event_validation_unknown",
  } as never);
  assert.equal(unknownEvent.statusCode, 400);

  await runtime.database.insertFrogSleepEntity({
    id: "sleep_session_orphan",
    appId: FROGSLEEP_APP_ID,
    kind: "sleep_session",
    ownerUserId: "user_alice",
    partnerUserId: "user_bob",
    relationshipId: "missing_relationship",
    status: "active",
    startsAt: new Date().toISOString(),
    payload: { participantStates: {} },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const orphanEvent = await runtime.app.handle({
    method: "POST",
    path: "/v1/shared-sessions/sleep_session_orphan/events",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { event_type: "returned" },
    requestId: "req_sleep_event_validation_orphan",
  } as never);
  assert.equal(orphanEvent.statusCode, 403);
});

test("FrogSleep sleep artifacts derive recovery, pause, and visibility semantics", async () => {
  const runtime = await createTestRuntime();
  const { aliceToken, bobToken, relationshipId } = await createSleepRelationship(runtime);

  const begin = await runtime.app.handle({
    method: "POST",
    path: "/v1/shared-sessions",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { relationship_id: relationshipId, date_anchor: "2026-04-05" },
    requestId: "req_sleep_artifacts_begin",
  } as never);
  assert.equal(begin.statusCode, 200);
  const sessionId = String(begin.body.data.session_id);
  await runtime.app.handle({
    method: "POST",
    path: `/v1/shared-sessions/${sessionId}/accept`,
    headers: { authorization: `Bearer ${bobToken}` },
    requestId: "req_sleep_artifacts_accept",
  } as never);
  for (const eventType of ["interrupted", "returned", "morning_completed"]) {
    const response = await runtime.app.handle({
      method: "POST",
      path: `/v1/shared-sessions/${sessionId}/events`,
      headers: { authorization: `Bearer ${aliceToken}` },
      body: { event_type: eventType },
      requestId: `req_sleep_artifacts_${eventType}`,
    } as never);
    assert.equal(response.statusCode, 200);
  }

  const summary = await runtime.app.handle({
    method: "GET",
    path: "/v1/shared-summaries/latest",
    headers: { authorization: `Bearer ${aliceToken}` },
    requestId: "req_sleep_artifacts_summary",
  } as never);
  assert.equal(summary.body.data.summary.had_recovery, true);
  assert.equal(summary.body.data.summary.returned_after_recovery, true);

  const pauseBegin = await runtime.app.handle({
    method: "POST",
    path: "/v1/shared-sessions",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { relationship_id: relationshipId, date_anchor: "2026-04-06" },
    requestId: "req_sleep_artifacts_pause_begin",
  } as never);
  const pauseResponse = await runtime.app.handle({
    method: "POST",
    path: `/v1/shared-sessions/${pauseBegin.body.data.session_id}/pause-tonight`,
    headers: { authorization: `Bearer ${aliceToken}` },
    requestId: "req_sleep_artifacts_pause",
  } as never);
  assert.equal(pauseResponse.statusCode, 200);
  const pausedSummary = await runtime.app.handle({
    method: "GET",
    path: "/v1/shared-summaries/latest",
    headers: { authorization: `Bearer ${aliceToken}` },
    requestId: "req_sleep_artifacts_paused_summary",
  } as never);
  assert.equal(pausedSummary.body.data.summary.paused_tonight, true);
  assert.equal(pausedSummary.body.data.summary.visible_state, "paused_tonight");

  await runtime.database.insertUser({
    id: "user_charlie",
    email: "charlie@example.com",
    passwordHash: "unused",
    passwordAlgo: "test",
    status: "ACTIVE",
    createdAt: "2026-04-01T00:00:00.000Z",
  });
  await runtime.services.appRegistryService.ensureMembership(FROGSLEEP_APP_ID, "user_charlie");
  const charlieSession = await runtime.services.authService.issueSession("user_charlie", FROGSLEEP_APP_ID);
  const charlieSummary = await runtime.app.handle({
    method: "GET",
    path: "/v1/shared-summaries/latest",
    headers: { authorization: `Bearer ${charlieSession.accessToken}` },
    requestId: "req_sleep_artifacts_charlie_summary",
  } as never);
  assert.equal(charlieSummary.statusCode, 200);
  assert.equal(charlieSummary.body.data.summary, null);
  const charlieRecap = await runtime.app.handle({
    method: "GET",
    path: "/v1/shared-recaps/latest",
    headers: { authorization: `Bearer ${charlieSession.accessToken}` },
    requestId: "req_sleep_artifacts_charlie_recap",
  } as never);
  assert.equal(charlieRecap.statusCode, 200);
  assert.equal(charlieRecap.body.data.recap, null);
});

test("FrogSleep sleep invite decline requires an authorized invitee", async () => {
  const runtime = await createTestRuntime();
  const aliceToken = await login(runtime, "alice@example.com");
  const bobToken = await login(runtime, "bob@example.com");
  const inviteResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/relationships/invites",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { invitee: "paper-note" },
    requestId: "req_sleep_decline_auth_invite",
  } as never);
  assert.equal(inviteResponse.statusCode, 200);

  const declineResponse = await runtime.app.handle({
    method: "POST",
    path: `/v1/relationships/invites/${inviteResponse.body.data.invite_id}/decline`,
    headers: { authorization: `Bearer ${bobToken}` },
    requestId: "req_sleep_decline_auth_forbidden",
  } as never);
  assert.equal(declineResponse.statusCode, 403);

  const cancelResponse = await runtime.app.handle({
    method: "POST",
    path: `/v1/relationships/invites/${inviteResponse.body.data.invite_id}/cancel`,
    headers: { authorization: `Bearer ${aliceToken}` },
    requestId: "req_sleep_decline_auth_cancel",
  } as never);
  assert.equal(cancelResponse.statusCode, 200);
  assert.equal(cancelResponse.body.data.status, "cancelled");
});

test("FrogSleep canonical sleep buddy paths work", async () => {
  const runtime = await createTestRuntime();
  const aliceToken = await login(runtime, "alice@example.com");
  const bobToken = await login(runtime, "bob@example.com");

  const inviteResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/sleep-buddy/invites",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    body: {
      invitee: "user_bob",
    },
    requestId: "req_sleep_canonical_invite",
  } as never);
  assert.equal(inviteResponse.statusCode, 200);

  const acceptResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/sleep-buddy/invites/accept-code",
    headers: {
      authorization: `Bearer ${bobToken}`,
    },
    body: {
      code: inviteResponse.body.data.code,
    },
    requestId: "req_sleep_canonical_accept",
  } as never);
  assert.equal(acceptResponse.statusCode, 200);

  const statusResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/frogsleep/sleep-buddy/guardianship/status",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    requestId: "req_sleep_canonical_status",
  } as never);
  assert.equal(statusResponse.statusCode, 200);
  assert.equal(statusResponse.body.data.current_relationship.status, "active");
});
