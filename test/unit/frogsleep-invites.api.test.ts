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
    path: "/v1/auth/password/login",
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
    path: "/v1/auth/email/auth-code",
    headers: {},
    body: { email },
    requestId: `req_invite_email_code_${email}`,
  } as never);
  assert.equal(codeResponse.statusCode, 200);

  const loginResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/email/complete",
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
    path: "/v1/relationships/invites",
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
    path: "/v1/focus/buddy/invites",
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

test("FrogSleep sleep buddy email invites require verified invitee ownership", async () => {
  const runtime = await createTestRuntime({
    registrationCodeGenerator: () => "123456",
  });
  const aliceToken = await login(runtime, "alice@example.com");

  const inviteResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/relationships/invites",
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
    path: "/v1/relationships/invites/accept-token",
    headers: {
      authorization: `Bearer ${intruderToken}`,
    },
    body: {
      token: inviteResponse.body.data.invite_token,
    },
    requestId: "req_sleep_email_invite_intruder_accept",
  } as never);
  assert.equal(intruderAcceptResponse.statusCode, 403);

  const inviteeToken = await loginWithEmailCode(runtime, "new-buddy@example.com");
  const inviteeAcceptResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/relationships/invites/accept-token",
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

  const reusedAcceptResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/relationships/invites/accept-code",
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
    path: "/v1/relationships/invites",
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
    path: `/v1/relationships/invites/${cancelledInvite.body.data.invite_id}/cancel`,
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
    requestId: "req_sleep_cancelled_invite_cancel",
  } as never);
  assert.equal(cancelResponse.statusCode, 200);

  const cancelledAccept = await runtime.app.handle({
    method: "POST",
    path: "/v1/relationships/invites/accept-code",
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
    path: "/v1/relationships/invites",
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
    path: "/v1/relationships/invites/accept-token",
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
    path: "/v1/relationships/invites",
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
    path: "/v1/relationships/invites/accept-code",
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
    path: "/v1/relationships/invites/pending",
    headers: {
      authorization: `Bearer ${bobToken}`,
    },
    requestId: "req_sleep_expired_pending",
  } as never);
  assert.equal(pendingSleepInvites.statusCode, 200);
  assert.equal(pendingSleepInvites.body.data.invites.length, 0);

  const focusInvite = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/buddy/invites",
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
    path: "/v1/focus/buddy/invites/accept-code",
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
    path: "/v1/focus/relationships/current",
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
