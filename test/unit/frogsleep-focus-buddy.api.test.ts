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
    requestId: `req_focus_login_${account}`,
  } as never);
  assert.equal(response.statusCode, 200);
  return String(response.body.data.access_token);
}

async function saveFocusMatchProfile(
  runtime: Awaited<ReturnType<typeof createTestRuntime>>,
  token: string,
  displayName: string,
  studyTypes: string[],
  activePeriod: string,
  matchingConsent: boolean,
) {
  const response = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/match-profile",
    headers: { authorization: `Bearer ${token}` },
    body: {
      display_name: displayName,
      study_types: studyTypes,
      scene_tags: studyTypes,
      active_period: activePeriod,
      matching_consent: matchingConsent,
    },
    requestId: `req_focus_match_profile_${displayName.toLowerCase()}`,
  } as never);
  assert.equal(response.statusCode, 200);
  return response;
}

async function createFocusRelationship(runtime: Awaited<ReturnType<typeof createTestRuntime>>) {
  const aliceToken = await login(runtime, "alice@example.com");
  const bobToken = await login(runtime, "bob@example.com");
  await saveFocusMatchProfile(runtime, aliceToken, "Alice", ["study"], "evening", true);
  await saveFocusMatchProfile(runtime, bobToken, "Bob", ["study"], "evening", true);
  const invite = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/matches/user_bob/invite",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: {},
    requestId: "req_focus_helper_invite",
  } as never);
  assert.equal(invite.statusCode, 200);
  const accept = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/buddy/invites/accept-code",
    headers: { authorization: `Bearer ${bobToken}` },
    body: { code: invite.body.data.invite_code },
    requestId: "req_focus_helper_accept",
  } as never);
  assert.equal(accept.statusCode, 200);
  return {
    aliceToken,
    bobToken,
    relationshipId: String(accept.body.data.relationship_id),
  };
}

test("FrogSleep focus buddy profile, invite, sessions, and interactions work", async () => {
  const runtime = await createTestRuntime();
  const aliceToken = await login(runtime, "alice@example.com");
  const bobToken = await login(runtime, "bob@example.com");
  const baseStart = new Date(Date.now() - 60 * 60 * 1000);
  const aliceStart = baseStart.toISOString();
  const aliceEnd = new Date(baseStart.getTime() + 30 * 60 * 1000).toISOString();
  const bobStart = new Date(baseStart.getTime() + 5 * 60 * 1000).toISOString();
  const bobEnd = new Date(baseStart.getTime() + 25 * 60 * 1000).toISOString();

  const aliceProfile = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/match-profile",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    body: {
      display_name: "Alice",
      study_types: ["deep_work"],
      scene_tags: ["morning", "reading"],
      active_period: "morning",
      matching_consent: true,
    },
    requestId: "req_focus_alice_profile",
  } as never);
  assert.equal(aliceProfile.statusCode, 200);

  const bobProfile = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/match-profile",
    headers: {
      authorization: `Bearer ${bobToken}`,
    },
    body: {
      display_name: "Bob",
      study_types: ["deep_work"],
      scene_tags: ["morning", "writing"],
      active_period: "morning",
      matching_consent: true,
    },
    requestId: "req_focus_bob_profile",
  } as never);
  assert.equal(bobProfile.statusCode, 200);

  const searchResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/matches/search",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    body: {
      limit: 10,
    },
    requestId: "req_focus_search",
  } as never);
  assert.equal(searchResponse.statusCode, 200);
  assert.equal(searchResponse.body.data.candidates[0].user_id, "user_bob");
  assert.equal(searchResponse.body.candidates[0].user_id, "user_bob");

  const inviteResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/matches/user_bob/invite",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    requestId: "req_focus_invite",
  } as never);
  assert.equal(inviteResponse.statusCode, 200);
  assert.equal(inviteResponse.body.data.status, "pending");
  assert.equal(inviteResponse.body.data.viewer_role, "owner");
  assert.equal(inviteResponse.body.data.invite_direction, "outgoing");
  assert.equal(inviteResponse.body.data.invite_link, inviteResponse.body.data.share_link);
  assert.equal(inviteResponse.body.data.invite_expires_at, inviteResponse.body.data.expires_at);

  const acceptResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/buddy/invites/accept-code",
    headers: {
      authorization: `Bearer ${bobToken}`,
    },
    body: {
      code: inviteResponse.body.data.invite_code,
    },
    requestId: "req_focus_accept",
  } as never);
  assert.equal(acceptResponse.statusCode, 200);
  assert.equal(acceptResponse.body.data.status, "accepted");
  assert.equal(acceptResponse.body.data.viewer_role, "partner");
  assert.equal(acceptResponse.body.data.invite_direction, "incoming");
  const acceptedFocusInvite = await runtime.database.findFrogSleepEntityByCode(
    "focus_invite",
    FROGSLEEP_APP_ID,
    String(inviteResponse.body.data.invite_code),
  );
  assert.equal(acceptedFocusInvite?.payload.accepted_by_user_id, "user_bob");
  assert.equal(acceptedFocusInvite?.payload.accept_source, "code");
  assert.equal(acceptResponse.body.data.source_invite_id, acceptedFocusInvite?.id);
  assert.equal(acceptResponse.body.data.accept_source, "code");

  const currentResponse = await runtime.app.handle({
    method: "GET",
    path: "/v1/focus/relationships/current",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    requestId: "req_focus_current_relationship",
  } as never);
  assert.equal(currentResponse.statusCode, 200);
  assert.equal(currentResponse.body.data.relationship.status, "accepted");
  assert.equal(currentResponse.body.data.relationship.buddy_user_id, "user_bob");
  const relationshipId = String(currentResponse.body.data.relationship.relationship_id);

  const unknownActionResponse = await runtime.app.handle({
    method: "POST",
    path: `/v1/focus/relationships/${relationshipId}/archive`,
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    requestId: "req_focus_relationship_unknown_action",
  } as never);
  assert.equal(unknownActionResponse.statusCode, 404);

  const currentAfterUnknownAction = await runtime.app.handle({
    method: "GET",
    path: "/v1/focus/relationships/current",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    requestId: "req_focus_current_relationship_after_unknown_action",
  } as never);
  assert.equal(currentAfterUnknownAction.statusCode, 200);
  assert.equal(currentAfterUnknownAction.body.data.relationship.status, "accepted");

  const aliceSession = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/sessions",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    body: {
      started_at: aliceStart,
      ended_at: aliceEnd,
      room: "reading",
      goal: "30m",
    },
    requestId: "req_focus_alice_session",
  } as never);
  assert.equal(aliceSession.statusCode, 200);
  assert.equal(aliceSession.body.data.minutes, 30);

  const bobSession = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/sessions",
    headers: {
      authorization: `Bearer ${bobToken}`,
    },
    body: {
      started_at: bobStart,
      ended_at: bobEnd,
      room: "writing",
      goal: "20m",
    },
    requestId: "req_focus_bob_session",
  } as never);
  assert.equal(bobSession.statusCode, 200);

  const statsResponse = await runtime.app.handle({
    method: "GET",
    path: "/v1/focus/stats/week",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    requestId: "req_focus_stats",
  } as never);
  assert.equal(statsResponse.statusCode, 200);
  assert.equal(statsResponse.body.data.total_minutes, 30);

  const messageResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/buddy/messages",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    body: {
      receiver_user_id: "user_bob",
      custom_text: "Nice focus session",
      context_session_type: "focus",
      context_session_id: aliceSession.body.data.session_id,
    },
    requestId: "req_focus_message",
  } as never);
  assert.equal(messageResponse.statusCode, 200);
  assert.equal(messageResponse.body.data.receiver_user_id, "user_bob");
  assert.equal(messageResponse.body.data.receiverUserId, "user_bob");
  assert.equal(messageResponse.body.data.customText, "Nice focus session");
  assert.equal(messageResponse.body.data.context.sessionType, "focus");
  assert.equal(messageResponse.body.data.sentAt, messageResponse.body.data.sent_at);

  const rateLimitedMessageResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/buddy/messages",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    body: {
      receiver_user_id: "user_bob",
      custom_text: "Another cheer too soon",
    },
    requestId: "req_focus_message_rate_limited",
  } as never);
  assert.equal(rateLimitedMessageResponse.statusCode, 429);
  assert.equal(rateLimitedMessageResponse.body.code, "AUTH_RATE_LIMITED");

  const presenceResponse = await runtime.app.handle({
    method: "GET",
    path: "/v1/focus/buddy/presence",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    query: {
      buddy_user_id: "user_bob",
    },
    requestId: "req_focus_presence",
  } as never);
  assert.equal(presenceResponse.statusCode, 200);
  assert.equal(presenceResponse.body.data.status, "recently_active");

  const partnerPresenceResponse = await runtime.app.handle({
    method: "GET",
    path: "/v1/focus/buddy/presence",
    headers: {
      authorization: `Bearer ${bobToken}`,
    },
    query: {
      buddy_user_id: "user_alice",
    },
    requestId: "req_focus_presence_partner",
  } as never);
  assert.equal(partnerPresenceResponse.statusCode, 200);
  assert.equal(partnerPresenceResponse.body.data.buddy_user_id, "user_alice");

  const comparisonResponse = await runtime.app.handle({
    method: "GET",
    path: "/v1/focus/buddy/comparison",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    requestId: "req_focus_comparison",
  } as never);
  assert.equal(comparisonResponse.statusCode, 200);
  assert.equal(comparisonResponse.body.data.comparison.buddy_user_id, "user_bob");
  assert.equal(comparisonResponse.body.buddy_user_id, "user_bob");
  assert.equal(comparisonResponse.body.comparison.buddy_user_id, "user_bob");

  const sharedResponse = await runtime.app.handle({
    method: "GET",
    path: "/v1/focus/buddy/shared",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    requestId: "req_focus_shared",
  } as never);
  assert.equal(sharedResponse.statusCode, 200);
  assert.equal(sharedResponse.body.data.moments.length, 1);
  assert.equal(sharedResponse.body.moments.length, 1);

  const achievementsResponse = await runtime.app.handle({
    method: "GET",
    path: "/v1/focus/achievements",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    requestId: "req_focus_achievements",
  } as never);
  assert.equal(achievementsResponse.statusCode, 200);
  const achievementTypes = achievementsResponse.body.data.achievements.map((item: { type: string }) => item.type);
  assert.ok(achievementTypes.includes("first_session"));
  assert.equal(typeof achievementsResponse.body.data.achievements[0].earned_at, "string");
});

test("FrogSleep controlled matching excludes dismissed and reported candidates", async () => {
  const runtime = await createTestRuntime();
  const aliceToken = await login(runtime, "alice@example.com");
  const bobToken = await login(runtime, "bob@example.com");

  await saveFocusMatchProfile(runtime, aliceToken, "Alice", ["study"], "evening", true);
  await saveFocusMatchProfile(runtime, bobToken, "Bob", ["study"], "evening", true);

  const firstSearch = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/matches/search",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { limit: 10 },
    requestId: "req_match_control_first_search",
  } as never);
  assert.equal(firstSearch.body.data.candidates[0].user_id, "user_bob");

  const dismiss = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/matches/user_bob/dismiss",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { reason: "not_now" },
    requestId: "req_match_control_dismiss",
  } as never);
  assert.equal(dismiss.statusCode, 200);
  assert.equal(dismiss.body.data.status, "dismissed");

  const afterDismiss = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/matches/search",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { limit: 10 },
    requestId: "req_match_control_after_dismiss",
  } as never);
  assert.deepEqual(afterDismiss.body.data.candidates, []);

  const report = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/matches/user_bob/report",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { reason: "unsafe_profile", note: "test" },
    requestId: "req_match_control_report",
  } as never);
  assert.equal(report.statusCode, 200);
  assert.equal(report.body.data.status, "reported");

  const selfDismiss = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/matches/user_alice/dismiss",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { reason: "self" },
    requestId: "req_match_control_self_dismiss",
  } as never);
  assert.equal(selfDismiss.statusCode, 400);

  const selfReport = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/matches/user_alice/report",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { reason: "self" },
    requestId: "req_match_control_self_report",
  } as never);
  assert.equal(selfReport.statusCode, 400);
});

test("FrogSleep focus session report validates timestamps and durations", async () => {
  const runtime = await createTestRuntime();
  const aliceToken = await login(runtime, "alice@example.com");
  const validStart = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const validEnd = new Date().toISOString();

  const invalidTimestamp = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/sessions",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { started_at: "not-a-date", ended_at: validEnd },
    requestId: "req_focus_invalid_timestamp",
  } as never);
  assert.equal(invalidTimestamp.statusCode, 400);

  const reversed = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/sessions",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { started_at: validEnd, ended_at: validStart },
    requestId: "req_focus_reversed_time",
  } as never);
  assert.equal(reversed.statusCode, 400);

  const negative = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/sessions",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { started_at: validStart, ended_at: validEnd, actual_minutes: -1 },
    requestId: "req_focus_negative_duration",
  } as never);
  assert.equal(negative.statusCode, 400);

  const nonFinite = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/sessions",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { started_at: validStart, ended_at: validEnd, planned_minutes: "Infinity" },
    requestId: "req_focus_nonfinite_duration",
  } as never);
  assert.equal(nonFinite.statusCode, 400);
});

test("FrogSleep focus invite accept does not partially accept invalid relationships", async () => {
  const runtime = await createTestRuntime();
  const aliceToken = await login(runtime, "alice@example.com");
  const bobToken = await login(runtime, "bob@example.com");
  await saveFocusMatchProfile(runtime, aliceToken, "Alice", ["study"], "evening", true);
  await saveFocusMatchProfile(runtime, bobToken, "Bob", ["study"], "evening", true);
  const invite = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/matches/user_bob/invite",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: {},
    requestId: "req_focus_atomic_invite",
  } as never);
  assert.equal(invite.statusCode, 200);
  await runtime.database.updateFrogSleepEntity("focus_relationship", FROGSLEEP_APP_ID, invite.body.data.relationship_id, {
    status: "revoked",
  });

  const accept = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/buddy/invites/accept-code",
    headers: { authorization: `Bearer ${bobToken}` },
    body: { code: invite.body.data.invite_code },
    requestId: "req_focus_atomic_accept",
  } as never);
  assert.equal(accept.statusCode, 400);

  const storedInvite = await runtime.database.findFrogSleepEntityByCode(
    "focus_invite",
    FROGSLEEP_APP_ID,
    String(invite.body.data.invite_code),
  );
  assert.equal(storedInvite?.status, "pending");
});

test("FrogSleep revoked focus relationships cannot be reused for buddy interactions", async () => {
  const runtime = await createTestRuntime();
  const { aliceToken, relationshipId } = await createFocusRelationship(runtime);

  const revoke = await runtime.app.handle({
    method: "POST",
    path: `/v1/focus/relationships/${relationshipId}/revoke`,
    headers: { authorization: `Bearer ${aliceToken}` },
    requestId: "req_focus_revoke_terminal",
  } as never);
  assert.equal(revoke.statusCode, 200);

  const secondRevoke = await runtime.app.handle({
    method: "POST",
    path: `/v1/focus/relationships/${relationshipId}/revoke`,
    headers: { authorization: `Bearer ${aliceToken}` },
    requestId: "req_focus_revoke_again",
  } as never);
  assert.equal(secondRevoke.statusCode, 400);

  const message = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/buddy/messages",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { receiver_user_id: "user_bob", custom_text: "after revoke" },
    requestId: "req_focus_message_after_revoke",
  } as never);
  assert.equal(message.statusCode, 403);

  const presence = await runtime.app.handle({
    method: "GET",
    path: "/v1/focus/buddy/presence",
    headers: { authorization: `Bearer ${aliceToken}` },
    query: { buddy_user_id: "user_bob" },
    requestId: "req_focus_presence_after_revoke",
  } as never);
  assert.equal(presence.statusCode, 403);
});

test("FrogSleep focus presence derives focusing, recent, idle, and stale states", async () => {
  const runtime = await createTestRuntime();
  const { aliceToken, bobToken, relationshipId } = await createFocusRelationship(runtime);
  const now = Date.now();

  const focusing = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/sessions",
    headers: { authorization: `Bearer ${bobToken}` },
    body: {
      started_at: new Date(now - 5 * 60 * 1000).toISOString(),
      ended_at: new Date(now + 25 * 60 * 1000).toISOString(),
      status: "in_progress",
      goal_tag: "writing",
    },
    requestId: "req_focus_presence_focusing_session",
  } as never);
  assert.equal(focusing.statusCode, 200);
  const focusingPresence = await runtime.app.handle({
    method: "GET",
    path: "/v1/focus/buddy/presence",
    headers: { authorization: `Bearer ${aliceToken}` },
    query: { buddy_user_id: "user_bob" },
    requestId: "req_focus_presence_focusing",
  } as never);
  assert.equal(focusingPresence.statusCode, 200);
  assert.equal(focusingPresence.body.data.status, "focusing");
  assert.equal(focusingPresence.body.data.goal_tag, "writing");

  await runtime.database.updateFrogSleepEntity("focus_session", FROGSLEEP_APP_ID, focusing.body.data.session_id, {
    status: "completed",
    startsAt: new Date(now - 60 * 60 * 1000).toISOString(),
    endsAt: new Date(now - 45 * 60 * 1000).toISOString(),
    updatedAt: new Date(now - 45 * 60 * 1000).toISOString(),
  });
  const recentPresence = await runtime.app.handle({
    method: "GET",
    path: "/v1/focus/buddy/presence",
    headers: { authorization: `Bearer ${aliceToken}` },
    query: { buddy_user_id: "user_bob" },
    requestId: "req_focus_presence_recent",
  } as never);
  assert.equal(recentPresence.body.data.status, "recently_active");

  await runtime.database.updateFrogSleepEntity("focus_session", FROGSLEEP_APP_ID, focusing.body.data.session_id, {
    endsAt: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
  });
  const idlePresence = await runtime.app.handle({
    method: "GET",
    path: "/v1/focus/buddy/presence",
    headers: { authorization: `Bearer ${aliceToken}` },
    query: { buddy_user_id: "user_bob" },
    requestId: "req_focus_presence_idle",
  } as never);
  assert.equal(idlePresence.body.data.status, "idle");

  await runtime.database.updateFrogSleepEntity("focus_session", FROGSLEEP_APP_ID, focusing.body.data.session_id, {
    endsAt: new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString(),
  });
  const stalePresence = await runtime.app.handle({
    method: "GET",
    path: "/v1/focus/buddy/presence",
    headers: { authorization: `Bearer ${aliceToken}` },
    query: { buddy_user_id: "user_bob" },
    requestId: "req_focus_presence_stale",
  } as never);
  assert.equal(stalePresence.body.data.status, "stale");

  await runtime.database.updateFrogSleepEntity("focus_relationship", FROGSLEEP_APP_ID, relationshipId, {
    status: "revoked",
  });
  const revokedPresence = await runtime.app.handle({
    method: "GET",
    path: "/v1/focus/buddy/presence",
    headers: { authorization: `Bearer ${aliceToken}` },
    query: { buddy_user_id: "user_bob" },
    requestId: "req_focus_presence_revoked",
  } as never);
  assert.equal(revokedPresence.statusCode, 403);
});

test("FrogSleep focus comparison, shared moments, and messages honor query filters", async () => {
  const runtime = await createTestRuntime();
  const { aliceToken, bobToken, relationshipId } = await createFocusRelationship(runtime);
  const weekStart = "2026-06-01";
  const otherWeekStart = "2026-06-08";

  for (const [token, start, room, requestId] of [
    [aliceToken, "2026-06-02T10:00:00.000Z", "room-a", "alice_room_a"],
    [bobToken, "2026-06-02T10:05:00.000Z", "room-a", "bob_room_a"],
    [aliceToken, "2026-06-09T10:00:00.000Z", "room-b", "alice_room_b"],
    [bobToken, "2026-06-09T10:05:00.000Z", "room-b", "bob_room_b"],
  ] as const) {
    const response = await runtime.app.handle({
      method: "POST",
      path: "/v1/focus/sessions",
      headers: { authorization: `Bearer ${token}` },
      body: {
        started_at: start,
        ended_at: new Date(new Date(start).getTime() + 30 * 60 * 1000).toISOString(),
        room_id: room,
        goal_tag: "study",
      },
      requestId: `req_focus_query_${requestId}`,
    } as never);
    assert.equal(response.statusCode, 200);
  }

  const comparison = await runtime.app.handle({
    method: "GET",
    path: "/v1/focus/buddy/comparison",
    headers: { authorization: `Bearer ${aliceToken}` },
    query: { week_start: weekStart },
    requestId: "req_focus_query_comparison_week",
  } as never);
  assert.equal(comparison.statusCode, 200);
  assert.equal(comparison.body.data.comparison.mine.week_start, "2026-06-01T00:00:00.000Z");
  assert.equal(comparison.body.data.comparison.my_minutes, 30);

  const otherComparison = await runtime.app.handle({
    method: "GET",
    path: "/v1/focus/buddy/comparison",
    headers: { authorization: `Bearer ${aliceToken}` },
    query: { week_start: otherWeekStart },
    requestId: "req_focus_query_comparison_other_week",
  } as never);
  assert.equal(otherComparison.body.data.comparison.mine.week_start, "2026-06-08T00:00:00.000Z");
  assert.equal(otherComparison.body.data.comparison.my_minutes, 30);

  const invalidComparison = await runtime.app.handle({
    method: "GET",
    path: "/v1/focus/buddy/comparison",
    headers: { authorization: `Bearer ${aliceToken}` },
    query: { week_start: "soon" },
    requestId: "req_focus_query_comparison_invalid",
  } as never);
  assert.equal(invalidComparison.statusCode, 400);

  const roomShared = await runtime.app.handle({
    method: "GET",
    path: "/v1/focus/buddy/shared",
    headers: { authorization: `Bearer ${aliceToken}` },
    query: {
      room_id: "room-a",
      from: "2026-06-02T00:00:00.000Z",
      to: "2026-06-03T00:00:00.000Z",
    },
    requestId: "req_focus_query_shared_room",
  } as never);
  assert.equal(roomShared.statusCode, 200);
  assert.equal(roomShared.body.data.moments.length, 1);
  assert.equal(roomShared.body.data.moments[0].room_id, "room-a");

  const invalidShared = await runtime.app.handle({
    method: "GET",
    path: "/v1/focus/buddy/shared",
    headers: { authorization: `Bearer ${aliceToken}` },
    query: { from: "2026-06-03T00:00:00.000Z", to: "2026-06-02T00:00:00.000Z" },
    requestId: "req_focus_query_shared_invalid",
  } as never);
  assert.equal(invalidShared.statusCode, 400);

  await runtime.database.insertFrogSleepEntity({
    id: "focus_message_old",
    appId: FROGSLEEP_APP_ID,
    kind: "focus_message",
    ownerUserId: "user_bob",
    partnerUserId: "user_alice",
    relationshipId,
    status: "sent",
    payload: { custom_text: "old" },
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  });
  await runtime.database.insertFrogSleepEntity({
    id: "focus_message_new",
    appId: FROGSLEEP_APP_ID,
    kind: "focus_message",
    ownerUserId: "user_bob",
    partnerUserId: "user_alice",
    relationshipId,
    status: "sent",
    payload: { custom_text: "new" },
    createdAt: "2026-06-02T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
  });
  const messages = await runtime.app.handle({
    method: "GET",
    path: "/v1/focus/buddy/messages",
    headers: { authorization: `Bearer ${aliceToken}` },
    query: { receiver_user_id: "user_bob", since: "2026-06-01T12:00:00.000Z", limit: "1" },
    requestId: "req_focus_query_messages",
  } as never);
  assert.equal(messages.statusCode, 200);
  assert.equal(messages.body.data.messages.length, 1);
  assert.equal(messages.body.data.messages[0].customText, "new");
  assert.equal(messages.body.data.pagination.has_more, false);

  const invalidMessages = await runtime.app.handle({
    method: "GET",
    path: "/v1/focus/buddy/messages",
    headers: { authorization: `Bearer ${aliceToken}` },
    query: { receiver_user_id: "user_bob", since: "yesterday" },
    requestId: "req_focus_query_messages_invalid",
  } as never);
  assert.equal(invalidMessages.statusCode, 400);
});

test("FrogSleep controlled matching hides candidates with pending outgoing invites", async () => {
  const runtime = await createTestRuntime();
  const aliceToken = await login(runtime, "alice@example.com");
  const bobToken = await login(runtime, "bob@example.com");

  await saveFocusMatchProfile(runtime, aliceToken, "Alice", ["study"], "evening", true);
  await saveFocusMatchProfile(runtime, bobToken, "Bob", ["study"], "evening", true);

  const invite = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/matches/user_bob/invite",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: {},
    requestId: "req_match_cooldown_invite",
  } as never);
  assert.equal(invite.statusCode, 200);

  const search = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/matches/search",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { limit: 10 },
    requestId: "req_match_cooldown_search",
  } as never);
  assert.deepEqual(search.body.data.candidates, []);
  assert.equal(search.body.data.empty_state.reason, "pending_invites");
  assert.equal(search.body.data.empty_state.title_key, "buddy_match.empty.pending_invites.title");
  assert.equal(search.body.data.empty_state.subtitle_key, "buddy_match.empty.pending_invites.subtitle");
  assert.equal(search.body.data.empty_state.pending_relationship_id, invite.body.data.relationship_id);
  assert.equal(search.body.data.empty_state.pending_user_id, "user_bob");

  const storedInvite = await runtime.database.findFrogSleepEntityByToken(
    "focus_invite",
    FROGSLEEP_APP_ID,
    String(invite.body.data.invite_token),
  );
  assert.ok(storedInvite);
  await runtime.database.updateFrogSleepEntity("focus_invite", FROGSLEEP_APP_ID, storedInvite.id, {
    payload: {
      ...storedInvite.payload,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    },
  });

  const afterExpiry = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/matches/search",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { limit: 10 },
    requestId: "req_match_cooldown_after_expiry",
  } as never);
  assert.equal(afterExpiry.body.data.candidates[0].user_id, "user_bob");
  const expiredRelationship = await runtime.database.findFrogSleepEntity(
    "focus_relationship",
    FROGSLEEP_APP_ID,
    String(invite.body.data.relationship_id),
  );
  assert.equal(expiredRelationship?.status, "expired");
});

test("FrogSleep focus matching ranks active-period matches and filters unsafe candidates", async () => {
  const runtime = await createTestRuntime();
  const aliceToken = await login(runtime, "alice@example.com");
  const bobToken = await login(runtime, "bob@example.com");

  const aliceProfile = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/match-profile",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: {
      display_name: "Alice",
      study_types: ["study"],
      scene_tags: ["study", "reading"],
      active_period: "morning",
      gender_identity: "woman",
      gender_preference: "women_only",
      matching_consent: true,
    },
    requestId: "req_focus_match_alice_profile",
  } as never);
  assert.equal(aliceProfile.statusCode, 200);

  const missingConsentProfile = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/match-profile",
    headers: { authorization: `Bearer ${bobToken}` },
    body: {
      display_name: "Bob",
      study_types: ["study"],
      scene_tags: ["study", "reading"],
      active_period: "morning",
      gender_identity: "woman",
      gender_preference: "no_preference",
    },
    requestId: "req_focus_match_bob_profile_no_consent",
  } as never);
  assert.equal(missingConsentProfile.statusCode, 200);

  const bobSearchWithoutConsent = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/matches/search",
    headers: { authorization: `Bearer ${bobToken}` },
    body: { limit: 10 },
    requestId: "req_focus_match_bob_search_without_consent",
  } as never);
  assert.equal(bobSearchWithoutConsent.statusCode, 400);

  const searchWithoutCandidateConsent = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/matches/search",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { limit: 10 },
    requestId: "req_focus_match_search_no_candidate_consent",
  } as never);
  assert.equal(searchWithoutCandidateConsent.statusCode, 200);
  assert.deepEqual(searchWithoutCandidateConsent.body.data.candidates, []);
  assert.equal(searchWithoutCandidateConsent.body.data.empty_state.reason, "no_compatible_candidates");

  const bobProfile = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/match-profile",
    headers: { authorization: `Bearer ${bobToken}` },
    body: {
      display_name: "Bob",
      study_types: ["study"],
      scene_tags: ["study", "reading"],
      active_period: "morning",
      gender_identity: "woman",
      gender_preference: "no_preference",
      matching_consent: true,
    },
    requestId: "req_focus_match_bob_profile",
  } as never);
  assert.equal(bobProfile.statusCode, 200);

  const staleUpdatedAt = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
  await runtime.database.updateFrogSleepEntity("focus_profile", FROGSLEEP_APP_ID, bobProfile.body.data.profile_id, {
    updatedAt: staleUpdatedAt,
  });

  const staleSearch = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/matches/search",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { limit: 10 },
    requestId: "req_focus_match_search_stale",
  } as never);
  assert.equal(staleSearch.statusCode, 200);
  assert.deepEqual(staleSearch.body.data.candidates, []);
  assert.equal(staleSearch.body.data.empty_state.reason, "no_recent_candidates");

  const refreshedBobProfile = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/match-profile",
    headers: { authorization: `Bearer ${bobToken}` },
    body: {
      display_name: "Bob",
      study_types: ["study"],
      scene_tags: ["study", "reading"],
      active_period: "morning",
      gender_identity: "woman",
      gender_preference: "no_preference",
      matching_consent: true,
    },
    requestId: "req_focus_match_bob_profile_refreshed",
  } as never);
  assert.equal(refreshedBobProfile.statusCode, 200);

  const samePeriodSearch = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/matches/search",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { limit: 10 },
    requestId: "req_focus_match_search_same_period",
  } as never);
  assert.equal(samePeriodSearch.statusCode, 200);
  assert.equal(samePeriodSearch.body.data.candidates[0].user_id, "user_bob");
  assert.ok(samePeriodSearch.body.data.candidates[0].score >= 90);
  assert.ok(samePeriodSearch.body.data.candidates[0].explanation.includes("active_period"));
  assert.ok(samePeriodSearch.body.data.candidates[0].explanation.includes("gender_preference"));
  assert.equal(samePeriodSearch.body.data.candidates[0].recommendation_type, "controlled_focus_partner");
  assert.equal(samePeriodSearch.body.data.candidates[0].privacy_note_key, "buddy_match.privacy.summary_only");
  assert.ok(Array.isArray(samePeriodSearch.body.data.candidates[0].why_recommended));
  assert.ok(samePeriodSearch.body.data.candidates[0].why_recommended.includes("active_period"));

  await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/match-profile",
    headers: { authorization: `Bearer ${bobToken}` },
    body: {
      display_name: "Bob",
      study_types: ["study"],
      scene_tags: ["study", "reading"],
      active_period: "night",
      gender_identity: "man",
      gender_preference: "no_preference",
      matching_consent: true,
    },
    requestId: "req_focus_match_bob_profile_incompatible",
  } as never);

  const incompatibleSearch = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/matches/search",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { limit: 10 },
    requestId: "req_focus_match_search_incompatible",
  } as never);
  assert.equal(incompatibleSearch.statusCode, 200);
  assert.deepEqual(incompatibleSearch.body.data.candidates, []);
  assert.equal(incompatibleSearch.body.data.empty_state.reason, "no_compatible_candidates");
});

test("FrogSleep canonical focus buddy paths work", async () => {
  const runtime = await createTestRuntime();
  const aliceToken = await login(runtime, "alice@example.com");
  await login(runtime, "bob@example.com");

  const profileResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/focus-buddy/match-profile",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: {
      display_name: "Alice",
      study_types: ["deep_work"],
      scene_tags: ["morning"],
      active_period: "morning",
      matching_consent: true,
    },
    requestId: "req_focus_canonical_profile",
  } as never);
  assert.equal(profileResponse.statusCode, 200);

  const sessionResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/focus-buddy/sessions",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: {
      started_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      ended_at: new Date().toISOString(),
      room: "reading",
      goal: "30m",
    },
    requestId: "req_focus_canonical_session",
  } as never);
  assert.equal(sessionResponse.statusCode, 200);

  const achievementsResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/frogsleep/focus-buddy/achievements",
    headers: { authorization: `Bearer ${aliceToken}` },
    requestId: "req_focus_canonical_achievements",
  } as never);
  assert.equal(achievementsResponse.statusCode, 200);
  assert.ok(Array.isArray(achievementsResponse.body.data.achievements));

  const inviteResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/focus-buddy/invites",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: {
      target: "user_bob",
    },
    requestId: "req_focus_canonical_direct_invite",
  } as never);
  assert.equal(inviteResponse.statusCode, 200);
  assert.equal(inviteResponse.body.data.status, "pending");
});
