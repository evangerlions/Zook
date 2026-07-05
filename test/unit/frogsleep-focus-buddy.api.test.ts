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
  assert.equal(presenceResponse.body.data.status, "idle");

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
