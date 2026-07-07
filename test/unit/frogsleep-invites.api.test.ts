import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { FROGSLEEP_APP_ID } from "../../src/modules/frogsleep/frogsleep-app.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

async function createTestRuntime(options: Parameters<typeof createApplication>[0] = {}) {
  return await createApplication({
    ...options,
    frogsleepEnabled: true,
    queueBackend: "memory",
    databaseFactory: (seed) => new InMemoryDatabase(seed),
  });
}

async function login(runtime: Awaited<ReturnType<typeof createTestRuntime>>, account: string) {
  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/auth/password/login",
    headers: {},
    body: {
      account,
      password: "Password1234",
    },
    requestId: `req_invite_login_${account}`,
  } as never);
  assert.equal(response.statusCode, 200);
  return String(response.body.data.access_token);
}

async function loginWithEmailCode(runtime: Awaited<ReturnType<typeof createTestRuntime>>, email: string) {
  const codeResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/auth/email/auth-code",
    headers: {},
    body: { email },
    requestId: `req_invite_email_code_${email}`,
  } as never);
  assert.equal(codeResponse.statusCode, 200);

  const loginResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/auth/email/complete",
    headers: {},
    body: {
      email,
      code: "123456",
    },
    requestId: `req_invite_email_complete_${email}`,
  } as never);
  assert.equal(loginResponse.statusCode, 200);
  return String(loginResponse.body.data.access_token);
}

test("FrogSleep invite responses use app config link bases", async () => {
  const runtime = await createTestRuntime();
  const aliceToken = await login(runtime, "alice@example.com");
  await login(runtime, "bob@example.com");

  const sleepInvite = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/sleep-buddy/invites",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    body: {
      invitee: "user_bob",
    },
    requestId: "req_sleep_invite_link_config",
  } as never);
  assert.equal(sleepInvite.statusCode, 200);
  assert.match(String(sleepInvite.body.data.share_link), /^frogsleep:\/\/sleep-buddy-invite\?/);

  const focusInvite = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/focus-buddy/invites",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    body: {
      target: "user_bob",
    },
    requestId: "req_focus_invite_link_config",
  } as never);
  assert.equal(focusInvite.statusCode, 200);
  assert.match(String(focusInvite.body.data.share_link), /^frogsleep:\/\/focus-invite\?/);
});

test("FrogSleep focus invite code accept stores conversion metadata", async () => {
  const runtime = await createTestRuntime();
  const aliceToken = await login(runtime, "alice@example.com");
  const bobToken = await login(runtime, "bob@example.com");

  const inviteResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/focus-buddy/invites",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    body: {
      target: "user_bob",
    },
    requestId: "req_focus_accept_metadata_invite",
  } as never);
  assert.equal(inviteResponse.statusCode, 200);

  const acceptResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/focus-buddy/invites/accept-code",
    headers: {
      authorization: `Bearer ${bobToken}`,
    },
    body: {
      code: inviteResponse.body.data.invite_code,
    },
    requestId: "req_focus_accept_metadata_code",
  } as never);
  assert.equal(acceptResponse.statusCode, 200);

  const acceptedFocusInvite = await runtime.database.findFrogSleepEntityByCode(
    "focus_invite",
    FROGSLEEP_APP_ID,
    String(inviteResponse.body.data.invite_code),
  );
  assert.equal(acceptedFocusInvite?.payload.accepted_by_user_id, "user_bob");
  assert.equal(acceptedFocusInvite?.payload.accept_source, "code");
  assert.match(String(acceptedFocusInvite?.payload.accepted_at), /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(acceptResponse.body.data.source_invite_id, acceptedFocusInvite?.id);
  assert.equal(acceptResponse.body.data.accept_source, "code");
});

test("FrogSleep sleep buddy email invites require verified invitee ownership", async () => {
  const runtime = await createTestRuntime({
    registrationCodeGenerator: () => "123456",
  });
  const aliceToken = await login(runtime, "alice@example.com");

  const inviteResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/sleep-buddy/invites",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    body: {
      invitee: "New-Buddy@Example.com",
    },
    requestId: "req_sleep_email_invite_create",
  } as never);
  assert.equal(inviteResponse.statusCode, 200);
  assert.equal(inviteResponse.body.data.invitee_email_snapshot, "new-buddy@example.com");
  assert.equal(inviteResponse.body.data.invite_code, inviteResponse.body.data.code);
  assert.equal(inviteResponse.body.data.invite_token, inviteResponse.body.data.token);
  assert.equal(inviteResponse.body.data.invite_link, inviteResponse.body.data.share_link);

  const storedInvite = await runtime.database.findFrogSleepEntity(
    "sleep_invite",
    FROGSLEEP_APP_ID,
    String(inviteResponse.body.data.invite_id),
  );
  assert.equal(storedInvite?.payload.inviteeEmailSnapshot, "new-buddy@example.com");

  const intruderToken = await loginWithEmailCode(runtime, "intruder@example.com");
  const intruderAcceptResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/sleep-buddy/invites/accept-token",
    headers: {
      authorization: `Bearer ${intruderToken}`,
    },
    body: {
      token: inviteResponse.body.data.invite_token,
    },
    requestId: "req_sleep_email_invite_intruder_accept",
  } as never);
  assert.equal(intruderAcceptResponse.statusCode, 403);

  runtime.database.insertUser({
    id: "user_new-buddy@example.com",
    email: "new-buddy@example.com",
    passwordHash: "test",
    passwordAlgo: "email-code-only",
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
  });
  const inviteeToken = await loginWithEmailCode(runtime, "new-buddy@example.com");
  const inviteeAcceptResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/sleep-buddy/invites/accept-token",
    headers: {
      authorization: `Bearer ${inviteeToken}`,
    },
    body: {
      token: inviteResponse.body.data.invite_token,
    },
    requestId: "req_sleep_email_invite_owner_accept",
  } as never);
  assert.equal(inviteeAcceptResponse.statusCode, 200);
  assert.equal(inviteeAcceptResponse.body.data.status, "active");
  const acceptedInvite = await runtime.database.findFrogSleepEntity(
    "sleep_invite",
    FROGSLEEP_APP_ID,
    String(inviteResponse.body.data.invite_id),
  );
  assert.equal(acceptedInvite?.payload.accepted_by_user_id, "user_new-buddy@example.com");
  assert.equal(acceptedInvite?.payload.accept_source, "token");
  assert.match(String(acceptedInvite?.payload.accepted_at), /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(inviteeAcceptResponse.body.data.source_invite_id, inviteResponse.body.data.invite_id);
  assert.equal(inviteeAcceptResponse.body.data.accept_source, "token");

  const reusedAcceptResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/sleep-buddy/invites/accept-code",
    headers: {
      authorization: `Bearer ${inviteeToken}`,
    },
    body: {
      code: inviteResponse.body.data.invite_code,
    },
    requestId: "req_sleep_email_invite_reused_accept",
  } as never);
  assert.equal(reusedAcceptResponse.statusCode, 400);
});

test("FrogSleep sleep buddy rejects cancelled and self-accepted invites", async () => {
  const runtime = await createTestRuntime();
  const aliceToken = await login(runtime, "alice@example.com");
  const bobToken = await login(runtime, "bob@example.com");

  const cancelledInvite = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/sleep-buddy/invites",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    body: {
      invitee: "user_bob",
    },
    requestId: "req_sleep_cancelled_invite_create",
  } as never);
  assert.equal(cancelledInvite.statusCode, 200);

  const cancelResponse = await runtime.app.handle({
    method: "POST",
    path: `/api/v1/frogsleep/sleep-buddy/invites/${cancelledInvite.body.data.invite_id}/cancel`,
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    requestId: "req_sleep_cancelled_invite_cancel",
  } as never);
  assert.equal(cancelResponse.statusCode, 200);

  const cancelledAccept = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/sleep-buddy/invites/accept-code",
    headers: {
      authorization: `Bearer ${bobToken}`,
    },
    body: {
      code: cancelledInvite.body.data.invite_code,
    },
    requestId: "req_sleep_cancelled_invite_accept",
  } as never);
  assert.equal(cancelledAccept.statusCode, 400);

  const selfInvite = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/sleep-buddy/invites",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    body: {
      invitee: "bob@example.com",
    },
    requestId: "req_sleep_self_accept_invite_create",
  } as never);
  assert.equal(selfInvite.statusCode, 200);

  const selfAccept = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/sleep-buddy/invites/accept-token",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    body: {
      token: selfInvite.body.data.invite_token,
    },
    requestId: "req_sleep_self_accept_invite_accept",
  } as never);
  assert.equal(selfAccept.statusCode, 400);
});

test("FrogSleep invite responses expose expiration and reject expired accepts", async () => {
  const runtime = await createTestRuntime();
  const aliceToken = await login(runtime, "alice@example.com");
  const bobToken = await login(runtime, "bob@example.com");

  const sleepInvite = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/sleep-buddy/invites",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    body: {
      invitee: "user_bob",
    },
    requestId: "req_sleep_expiring_invite",
  } as never);
  assert.equal(sleepInvite.statusCode, 200);
  assert.equal(typeof sleepInvite.body.data.expires_at, "string");

  await runtime.database.updateFrogSleepEntity("sleep_invite", FROGSLEEP_APP_ID, sleepInvite.body.data.invite_id, {
    payload: {
      ...sleepInvite.body.data,
      expires_at: "2020-01-01T00:00:00.000Z",
    },
  });

  const sleepAccept = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/sleep-buddy/invites/accept-code",
    headers: {
      authorization: `Bearer ${bobToken}`,
    },
    body: {
      code: sleepInvite.body.data.code,
    },
    requestId: "req_sleep_expired_accept",
  } as never);
  assert.equal(sleepAccept.statusCode, 400);

  const pendingSleepInvites = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/frogsleep/sleep-buddy/invites/pending",
    headers: {
      authorization: `Bearer ${bobToken}`,
    },
    requestId: "req_sleep_expired_pending",
  } as never);
  assert.equal(pendingSleepInvites.statusCode, 200);
  assert.equal(pendingSleepInvites.body.data.invites.length, 0);

  const focusInvite = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/focus-buddy/invites",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    body: {
      target: "user_bob",
    },
    requestId: "req_focus_expiring_invite",
  } as never);
  assert.equal(focusInvite.statusCode, 200);
  assert.equal(typeof focusInvite.body.data.expires_at, "string");

  const focusInviteRecord = await runtime.database.findFrogSleepEntityByCode(
    "focus_invite",
    FROGSLEEP_APP_ID,
    focusInvite.body.data.invite_code,
  );
  assert.ok(focusInviteRecord);
  await runtime.database.updateFrogSleepEntity("focus_invite", FROGSLEEP_APP_ID, focusInviteRecord.id, {
    payload: {
      ...focusInviteRecord.payload,
      expires_at: "2020-01-01T00:00:00.000Z",
    },
  });

  const focusAccept = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/focus-buddy/invites/accept-code",
    headers: {
      authorization: `Bearer ${bobToken}`,
    },
    body: {
      code: focusInvite.body.data.invite_code,
    },
    requestId: "req_focus_expired_accept",
  } as never);
  assert.equal(focusAccept.statusCode, 400);

  const currentFocus = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/frogsleep/focus-buddy/relationships/current",
    headers: {
      authorization: `Bearer ${bobToken}`,
    },
    requestId: "req_focus_expired_current",
  } as never);
  assert.equal(currentFocus.statusCode, 200);
  assert.equal(currentFocus.body.data.relationship, null);
});

test("FrogSleep invite redirect endpoints return deep links", async () => {
  const runtime = await createTestRuntime();

  const sleepRedirect = await runtime.app.handle({
    method: "GET",
    path: "/frogsleep/sleep-buddy-invite",
    headers: {},
    query: {
      token: "token_1",
      code: "ABC123",
    },
    requestId: "req_sleep_invite_redirect",
  } as never);
  assert.equal(sleepRedirect.statusCode, 302);
  assert.equal(sleepRedirect.headers?.Location, "frogsleep://sleep-buddy-invite?token=token_1&code=ABC123");

  const focusRedirect = await runtime.app.handle({
    method: "GET",
    path: "/frogsleep/focus-invite",
    headers: {},
    query: {
      token: "token_2",
      code: "XYZ789",
    },
    requestId: "req_focus_invite_redirect",
  } as never);
  assert.equal(focusRedirect.statusCode, 302);
  assert.equal(focusRedirect.headers?.Location, "frogsleep://focus-invite?token=token_2&code=XYZ789");
});

test("FrogSleep invite redirects keep deep links when open tracking fails", async () => {
  const runtime = await createTestRuntime();
  runtime.database.findFrogSleepEntityByToken = () => {
    throw new Error("tracking lookup failed");
  };

  const sleepRedirect = await runtime.app.handle({
    method: "GET",
    path: "/frogsleep/sleep-buddy-invite",
    headers: {},
    query: {
      token: "token_1",
      code: "ABC123",
    },
    requestId: "req_sleep_invite_redirect_tracking_failure",
  } as never);
  assert.equal(sleepRedirect.statusCode, 302);
  assert.equal(sleepRedirect.headers?.Location, "frogsleep://sleep-buddy-invite?token=token_1&code=ABC123");

  const focusRedirect = await runtime.app.handle({
    method: "GET",
    path: "/frogsleep/focus-invite",
    headers: {},
    query: {
      token: "token_2",
      code: "XYZ789",
    },
    requestId: "req_focus_invite_redirect_tracking_failure",
  } as never);
  assert.equal(focusRedirect.statusCode, 302);
  assert.equal(focusRedirect.headers?.Location, "frogsleep://focus-invite?token=token_2&code=XYZ789");
});

test("FrogSleep invite redirects track open conversion metadata", async () => {
  const runtime = await createTestRuntime();
  const aliceToken = await login(runtime, "alice@example.com");

  const sleepInvite = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/sleep-buddy/invites",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { invitee: "user_bob", role: "friend" },
    requestId: "req_sleep_invite_open_create",
  } as never);
  assert.equal(sleepInvite.statusCode, 200);

  const sleepRedirect = await runtime.app.handle({
    method: "GET",
    path: "/frogsleep/sleep-buddy-invite",
    query: {
      token: sleepInvite.body.data.invite_token,
      code: sleepInvite.body.data.invite_code,
    },
    headers: { "user-agent": "UnitTest/1.0" },
    requestId: "req_sleep_invite_open_redirect",
  } as never);
  assert.equal(sleepRedirect.statusCode, 302);

  const storedSleepInvite = await runtime.database.findFrogSleepEntity(
    "sleep_invite",
    FROGSLEEP_APP_ID,
    String(sleepInvite.body.data.invite_id),
  );
  assert.equal(storedSleepInvite?.payload.open_count, 1);
  assert.equal(storedSleepInvite?.payload.last_open_source, "redirect");
  assert.equal(storedSleepInvite?.payload.last_open_user_agent, "UnitTest/1.0");
  assert.match(String(storedSleepInvite?.payload.first_opened_at), /^\d{4}-\d{2}-\d{2}T/);
  assert.match(String(storedSleepInvite?.payload.last_opened_at), /^\d{4}-\d{2}-\d{2}T/);

  const focusInvite = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/focus-buddy/invites",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { user_id: "user_bob" },
    requestId: "req_focus_invite_open_create",
  } as never);
  assert.equal(focusInvite.statusCode, 200);

  const focusRedirect = await runtime.app.handle({
    method: "GET",
    path: "/frogsleep/focus-invite",
    query: {
      token: focusInvite.body.data.invite_token,
      code: focusInvite.body.data.invite_code,
    },
    headers: { "user-agent": "UnitTest/2.0" },
    requestId: "req_focus_invite_open_redirect",
  } as never);
  assert.equal(focusRedirect.statusCode, 302);

  const storedFocusInvite = await runtime.database.findFrogSleepEntityByToken(
    "focus_invite",
    FROGSLEEP_APP_ID,
    String(focusInvite.body.data.invite_token),
  );
  assert.equal(storedFocusInvite?.payload.open_count, 1);
  assert.equal(storedFocusInvite?.payload.last_open_source, "redirect");
  assert.equal(storedFocusInvite?.payload.last_open_user_agent, "UnitTest/2.0");
  assert.match(String(storedFocusInvite?.payload.first_opened_at), /^\d{4}-\d{2}-\d{2}T/);
  assert.match(String(storedFocusInvite?.payload.last_opened_at), /^\d{4}-\d{2}-\d{2}T/);
});

test("FrogSleep invite preview supports post-login recovery without accepting", async () => {
  const runtime = await createTestRuntime();
  const aliceToken = await login(runtime, "alice@example.com");
  const bobToken = await login(runtime, "bob@example.com");

  const focusInvite = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/focus-buddy/invites",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { user_id: "user_bob" },
    requestId: "req_focus_preview_invite_create",
  } as never);

  const preview = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/frogsleep/focus-buddy/invites/preview",
    query: { token: focusInvite.body.data.invite_token },
    headers: { authorization: `Bearer ${bobToken}` },
    requestId: "req_focus_preview_token",
  } as never);
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.body.data.invite.invite_id, focusInvite.body.data.relationship_id);
  assert.equal(preview.body.data.invite.status, "pending");
  assert.equal(preview.body.data.invite.viewer_can_accept, true);
  assert.equal(preview.body.data.invite.accept_method, "token");
  assert.equal(preview.body.data.invite.domain, "focus");

  const current = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/frogsleep/focus-buddy/relationships/current",
    headers: { authorization: `Bearer ${bobToken}` },
    requestId: "req_focus_preview_current",
  } as never);
  assert.equal(current.body.data.relationship, null);
});

test("FrogSleep sleep invite preview ignores stale relationship ids", async () => {
  const runtime = await createTestRuntime();
  const aliceToken = await login(runtime, "alice@example.com");
  const bobToken = await login(runtime, "bob@example.com");

  const sleepInvite = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/sleep-buddy/invites",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { invitee: "user_bob" },
    requestId: "req_sleep_preview_stale_relation_create",
  } as never);
  assert.equal(sleepInvite.statusCode, 200);

  await runtime.database.updateFrogSleepEntity("sleep_invite", FROGSLEEP_APP_ID, sleepInvite.body.data.invite_id, {
    relationshipId: "sleep_relationship_missing",
  });

  const preview = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/frogsleep/sleep-buddy/invites/preview",
    query: { token: sleepInvite.body.data.invite_token },
    headers: { authorization: `Bearer ${bobToken}` },
    requestId: "req_sleep_preview_stale_relation_token",
  } as never);
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.body.data.invite.invite_id, sleepInvite.body.data.invite_id);
  assert.equal(preview.body.data.invite.raw_invite_id, sleepInvite.body.data.invite_id);
  assert.equal(preview.body.data.invite.viewer_can_accept, true);
});

test("FrogSleep sleep invite preview does not mark inviter as able to accept untargeted invites", async () => {
  const runtime = await createTestRuntime();
  const aliceToken = await login(runtime, "alice@example.com");

  const sleepInvite = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/sleep-buddy/invites",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { invitee: "paper-note-invitee" },
    requestId: "req_sleep_preview_self_open_invite_create",
  } as never);
  assert.equal(sleepInvite.statusCode, 200);

  const preview = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/frogsleep/sleep-buddy/invites/preview",
    query: { token: sleepInvite.body.data.invite_token },
    headers: { authorization: `Bearer ${aliceToken}` },
    requestId: "req_sleep_preview_self_open_invite_token",
  } as never);
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.body.data.invite.viewer_can_accept, false);

  const current = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/frogsleep/sleep-buddy/relationships/current",
    headers: { authorization: `Bearer ${aliceToken}` },
    requestId: "req_sleep_preview_self_open_invite_current",
  } as never);
  assert.equal(current.body.data.relationship, null);
});
