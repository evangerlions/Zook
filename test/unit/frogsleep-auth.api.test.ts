import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

async function createTestRuntime(options: Parameters<typeof createApplication>[0] = {}) {
  return await createApplication({
    ...options,
    frogsleepEnabled: true,
    queueBackend: "memory",
    databaseFactory: (seed) => new InMemoryDatabase(seed),
  });
}

test("FrogSleep password login reuses shared account auth and creates FrogSleep membership", async () => {
  const runtime = await createTestRuntime();

  const response = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/password/login",
    headers: {},
    body: {
      account: "alice@example.com",
      password: "Password1234",
    },
    requestId: "req_frogsleep_password_login",
  } as never);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.app_id, "frogsleep");
  assert.equal(response.body.user_id, "user_alice");
  assert.equal(typeof response.body.access_token, "string");
  assert.equal(typeof response.body.refresh_token, "string");
  assert.equal(typeof response.body.refresh_token_expires_at, "string");
  assert.equal(response.body.data.app_id, "frogsleep");
  assert.equal(response.body.data.user_id, "user_alice");
  assert.equal(typeof response.body.data.access_token, "string");
  assert.equal(typeof response.body.data.refresh_token, "string");
  assert.ok(await runtime.database.findAppUser("frogsleep", "user_alice"));
});

test("FrogSleep password login accepts the Go identifier field alias", async () => {
  const runtime = await createTestRuntime();

  const response = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/password/login",
    headers: {},
    body: {
      identifier: "alice@example.com",
      password: "Password1234",
    },
    requestId: "req_frogsleep_password_login_identifier",
  } as never);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.user_id, "user_alice");
  assert.equal(response.body.data.user_id, "user_alice");
});

test("FrogSleep email and password reset code requests resolve to the FrogSleep app", async () => {
  const runtime = await createTestRuntime();

  const emailCodeResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/email/send-code",
    headers: {},
    body: {
      email: "alice@example.com",
    },
    requestId: "req_frogsleep_email_code",
  } as never);

  assert.equal(emailCodeResponse.statusCode, 200);
  assert.equal(emailCodeResponse.body.accepted, true);
  assert.equal(emailCodeResponse.body.verification_id, "alice@example.com");
  assert.equal(emailCodeResponse.body.data.accepted, true);

  const passwordResetCodeResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/password/reset/request",
    headers: {},
    body: {
      email: "alice@example.com",
    },
    requestId: "req_frogsleep_password_reset_code",
  } as never);

  assert.equal(passwordResetCodeResponse.statusCode, 200);
  assert.equal(passwordResetCodeResponse.body.accepted, true);
  assert.equal(passwordResetCodeResponse.body.verification_id, "alice@example.com");
  assert.equal(passwordResetCodeResponse.body.data.accepted, true);
});

test("FrogSleep email register without code sends a registration code", async () => {
  const runtime = await createTestRuntime({
    registrationCodeGenerator: () => "123456",
  });

  const response = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/email/register",
    headers: {},
    body: {
      email: "frog-register@example.com",
    },
    requestId: "req_frogsleep_email_register_send_code",
  } as never);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.accepted, true);
  assert.equal(response.body.verification_id, "frog-register@example.com");
  assert.equal(response.body.data.accepted, true);
});

test("FrogSleep password register without code sends a registration code", async () => {
  const runtime = await createTestRuntime({
    registrationCodeGenerator: () => "123456",
  });

  const response = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/password/register",
    headers: {},
    body: {
      email: "frog-password-start@example.com",
      password: "Password1234",
    },
    requestId: "req_frogsleep_password_register_send_code",
  } as never);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.accepted, true);
  assert.equal(response.body.verification_id, "frog-password-start@example.com");
  assert.equal(response.body.data.accepted, true);
});

test("FrogSleep email verify and password reset accept verification_id alias", async () => {
  const runtime = await createTestRuntime({
    registrationCodeGenerator: () => "123456",
  });

  await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/email/auth-code",
    headers: {},
    body: {
      email: "frog-code@example.com",
    },
    requestId: "req_frogsleep_email_verify_code",
  } as never);

  const verifyResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/email/verify",
    headers: {},
    body: {
      verification_id: "frog-code@example.com",
      code: "123456",
    },
    requestId: "req_frogsleep_email_verify_alias",
  } as never);

  assert.equal(verifyResponse.statusCode, 200);
  assert.equal(verifyResponse.body.app_id, "frogsleep");
  assert.equal(verifyResponse.body.data.app_id, "frogsleep");

  await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/password/reset/request",
    headers: {},
    body: {
      email: "frog-code@example.com",
    },
    requestId: "req_frogsleep_password_reset_alias_code",
  } as never);

  const resetResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/password/reset/confirm",
    headers: {},
    body: {
      verification_id: "frog-code@example.com",
      code: "123456",
      new_password: "Password5678",
    },
    requestId: "req_frogsleep_password_reset_alias",
  } as never);

  assert.equal(resetResponse.statusCode, 200);
  assert.equal(resetResponse.body.app_id, "frogsleep");
  assert.equal(resetResponse.body.data.app_id, "frogsleep");
});

test("FrogSleep password register and change password issue scoped sessions", async () => {
  const runtime = await createTestRuntime({
    registrationCodeGenerator: () => "123456",
  });

  await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/email/register",
    headers: {},
    body: {
      email: "frog-password@example.com",
    },
    requestId: "req_frogsleep_password_register_code",
  } as never);

  const registerResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/password/register",
    headers: {},
    body: {
      email: "frog-password@example.com",
      code: "123456",
      password: "Password1234",
    },
    requestId: "req_frogsleep_password_register",
  } as never);

  assert.equal(registerResponse.statusCode, 200);
  assert.equal(registerResponse.body.app_id, "frogsleep");
  assert.equal(registerResponse.body.data.app_id, "frogsleep");

  const changeResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/password/change",
    headers: {
      authorization: `Bearer ${registerResponse.body.access_token}`,
    },
    body: {
      current_password: "Password1234",
      new_password: "Password5678",
    },
    requestId: "req_frogsleep_password_change",
  } as never);

  assert.equal(changeResponse.statusCode, 200);
  assert.equal(changeResponse.body.app_id, "frogsleep");
  assert.equal(changeResponse.body.data.app_id, "frogsleep");

  const oldPasswordLogin = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/password/login",
    headers: {},
    body: {
      identifier: "frog-password@example.com",
      password: "Password1234",
    },
    requestId: "req_frogsleep_old_password_login",
  } as never);
  assert.equal(oldPasswordLogin.statusCode, 401);

  const newPasswordLogin = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/password/login",
    headers: {},
    body: {
      identifier: "frog-password@example.com",
      password: "Password5678",
    },
    requestId: "req_frogsleep_new_password_login",
  } as never);
  assert.equal(newPasswordLogin.statusCode, 200);
  assert.equal(newPasswordLogin.body.app_id, "frogsleep");

  const oldPasswordAppLogin = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login",
    headers: {},
    body: {
      appId: "app_a",
      account: "frog-password@example.com",
      password: "Password1234",
      clientType: "app",
    },
    requestId: "req_frogsleep_shared_old_password_app_login",
  } as never);
  assert.equal(oldPasswordAppLogin.statusCode, 401);

  const newPasswordAppLogin = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login",
    headers: {},
    body: {
      appId: "app_a",
      account: "frog-password@example.com",
      password: "Password5678",
      clientType: "app",
    },
    requestId: "req_frogsleep_shared_new_password_app_login",
  } as never);
  assert.equal(newPasswordAppLogin.statusCode, 200);
  assert.equal(runtime.database.findAppUser("app_a", newPasswordAppLogin.body.data.user.id)?.status, "ACTIVE");
});

test("FrogSleep me and devices require FrogSleep-scoped tokens", async () => {
  const runtime = await createTestRuntime();

  const frogSleepLogin = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/password/login",
    headers: {},
    body: {
      account: "alice@example.com",
      password: "Password1234",
    },
    requestId: "req_frogsleep_device_login",
  } as never);
  const frogSleepToken = String(frogSleepLogin.body.data.access_token);

  const meResponse = await runtime.app.handle({
    method: "GET",
    path: "/v1/me",
    headers: {
      authorization: `Bearer ${frogSleepToken}`,
    },
    requestId: "req_frogsleep_me",
  } as never);
  assert.equal(meResponse.statusCode, 200);
  assert.equal(meResponse.body.app_id, "frogsleep");
  assert.equal(meResponse.body.user_id, "user_alice");
  assert.equal(meResponse.body.verified_email, "alice@example.com");
  assert.equal(meResponse.body.email_verified, true);
  assert.equal(meResponse.body.data.app_id, "frogsleep");

  const deviceResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/me/devices",
    headers: {
      authorization: `Bearer ${frogSleepToken}`,
    },
    body: {
      platform: "ios",
      push_token: "push_token_1",
      app_version: "1.0.0",
      timezone: "Asia/Shanghai",
    },
    requestId: "req_frogsleep_device_register",
  } as never);
  assert.equal(deviceResponse.statusCode, 200);
  assert.equal(deviceResponse.body.device.pushToken, "push_token_1");
  assert.equal(deviceResponse.body.data.device.pushToken, "push_token_1");

  const updatedDeviceResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/me/devices",
    headers: {
      authorization: `Bearer ${frogSleepToken}`,
    },
    body: {
      platform: "ios",
      push_token: "push_token_1",
      app_version: "1.1.0",
      timezone: "Asia/Shanghai",
    },
    requestId: "req_frogsleep_device_upsert",
  } as never);
  assert.equal(updatedDeviceResponse.statusCode, 200);
  assert.equal(updatedDeviceResponse.body.data.device.id, deviceResponse.body.data.device.id);
  assert.equal(updatedDeviceResponse.body.data.device.appVersion, "1.1.0");

  const deleteResponse = await runtime.app.handle({
    method: "DELETE",
    path: `/v1/me/devices/${deviceResponse.body.data.device.id}`,
    headers: {
      authorization: `Bearer ${frogSleepToken}`,
    },
    requestId: "req_frogsleep_device_delete",
  } as never);
  assert.equal(deleteResponse.statusCode, 200);
  assert.equal(deleteResponse.body.status, "deleted");
  assert.equal(deleteResponse.body.deleted, true);
  assert.equal(deleteResponse.body.data.deleted, true);
  assert.equal((await runtime.database.listFrogSleepDevices({ appId: "frogsleep", userId: "user_alice" })).length, 0);

  const appALogin = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login",
    headers: {},
    body: {
      appId: "app_a",
      account: "alice@example.com",
      password: "Password1234",
      clientType: "app",
    },
    requestId: "req_app_a_login_for_frogsleep_reject",
  } as never);
  const appAToken = String(appALogin.body.data.accessToken);
  const rejected = await runtime.app.handle({
    method: "GET",
    path: "/v1/me",
    headers: {
      authorization: `Bearer ${appAToken}`,
    },
    requestId: "req_frogsleep_reject_app_a_token",
  } as never);
  assert.equal(rejected.statusCode, 403);
  assert.equal(rejected.body.code, "AUTH_APP_SCOPE_MISMATCH");
});

test("FrogSleep protected routes require active FrogSleep membership", async () => {
  const runtime = await createTestRuntime();

  const login = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/password/login",
    headers: {},
    body: {
      account: "alice@example.com",
      password: "Password1234",
    },
    requestId: "req_frogsleep_membership_login",
  } as never);
  const token = String(login.body.data.access_token);

  runtime.database.updateAppUserStatus("frogsleep", "user_alice", "DELETED");
  const deletedResponse = await runtime.app.handle({
    method: "GET",
    path: "/v1/me",
    headers: {
      authorization: `Bearer ${token}`,
    },
    requestId: "req_frogsleep_membership_deleted",
  } as never);
  assert.equal(deletedResponse.statusCode, 403);
  assert.equal(deletedResponse.body.code, "APP_MEMBER_DELETED");

  runtime.database.updateAppUserStatus("frogsleep", "user_alice", "BLOCKED");
  const blockedResponse = await runtime.app.handle({
    method: "GET",
    path: "/v1/me",
    headers: {
      authorization: `Bearer ${token}`,
    },
    requestId: "req_frogsleep_membership_blocked",
  } as never);
  assert.equal(blockedResponse.statusCode, 403);
  assert.equal(blockedResponse.body.code, "APP_MEMBER_BLOCKED");
});

test("FrogSleep email bind verifies the new email before updating the shared Zook user account", async () => {
  const runtime = await createTestRuntime({
    registrationCodeGenerator: () => "123456",
  });

  const login = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/password/login",
    headers: {},
    body: {
      account: "alice@example.com",
      password: "Password1234",
    },
    requestId: "req_frogsleep_email_bind_login",
  } as never);
  const token = String(login.body.data.access_token);

  const unverifiedBindResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/email/bind",
    headers: {
      authorization: `Bearer ${token}`,
    },
    body: {
      email: "alice-frogsleep@example.com",
    },
    requestId: "req_frogsleep_email_bind_unverified",
  } as never);
  assert.equal(unverifiedBindResponse.statusCode, 400);
  assert.equal(unverifiedBindResponse.body.code, "REQ_INVALID_BODY");
  assert.equal((await runtime.database.findUserById("user_alice"))?.email, "alice@example.com");

  await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/email/send-code",
    headers: {},
    body: {
      email: "alice-frogsleep@example.com",
    },
    requestId: "req_frogsleep_email_bind_login_code",
  } as never);
  const loginCodeBindResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/email/bind",
    headers: {
      authorization: `Bearer ${token}`,
    },
    body: {
      email: "alice-frogsleep@example.com",
      code: "123456",
    },
    requestId: "req_frogsleep_email_bind_reject_login_code",
  } as never);
  assert.equal(loginCodeBindResponse.statusCode, 401);
  assert.equal(loginCodeBindResponse.body.code, "AUTH_VERIFICATION_CODE_INVALID");
  assert.equal((await runtime.database.findUserById("user_alice"))?.email, "alice@example.com");

  const changeCodeResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/email/change-code",
    headers: {
      authorization: `Bearer ${token}`,
    },
    body: {
      email: "alice-frogsleep@example.com",
    },
    requestId: "req_frogsleep_email_bind_change_code",
  } as never);
  assert.equal(changeCodeResponse.statusCode, 200);
  assert.equal(changeCodeResponse.body.accepted, true);
  assert.equal(changeCodeResponse.body.verification_id, "alice-frogsleep@example.com");

  const invalidBindResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/email/bind",
    headers: {
      authorization: `Bearer ${token}`,
    },
    body: {
      email: "alice-frogsleep@example.com",
      code: "000000",
    },
    requestId: "req_frogsleep_email_bind_invalid_code",
  } as never);
  assert.equal(invalidBindResponse.statusCode, 401);
  assert.equal(invalidBindResponse.body.code, "AUTH_VERIFICATION_CODE_INVALID");
  assert.equal((await runtime.database.findUserById("user_alice"))?.email, "alice@example.com");

  const bindResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/email/bind",
    headers: {
      authorization: `Bearer ${token}`,
    },
    body: {
      email: "alice-frogsleep@example.com",
      code: "123456",
    },
    requestId: "req_frogsleep_email_bind",
  } as never);

  assert.equal(bindResponse.statusCode, 200);
  assert.equal(bindResponse.body.data.user.email, "alice-frogsleep@example.com");
  assert.equal((await runtime.database.findUserById("user_alice"))?.email, "alice-frogsleep@example.com");

  const replayResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/email/change",
    headers: {
      authorization: `Bearer ${token}`,
    },
    body: {
      email: "alice-frogsleep@example.com",
      code: "123456",
    },
    requestId: "req_frogsleep_email_change_replay_code",
  } as never);
  assert.equal(replayResponse.statusCode, 401);
  assert.equal(replayResponse.body.code, "AUTH_VERIFICATION_CODE_INVALID");

  const conflictResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/email/change",
    headers: {
      authorization: `Bearer ${token}`,
    },
    body: {
      email: "bob@example.com",
      code: "123456",
    },
    requestId: "req_frogsleep_email_change_conflict",
  } as never);
  assert.equal(conflictResponse.statusCode, 409);
  assert.equal(conflictResponse.body.code, "AUTH_ACCOUNT_ALREADY_EXISTS");
});

test("FrogSleep account deletion cleans FrogSleep runtime data only", async () => {
  const runtime = await createTestRuntime();

  const login = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/password/login",
    headers: {},
    body: {
      account: "alice@example.com",
      password: "Password1234",
    },
    requestId: "req_frogsleep_delete_login",
  } as never);
  const token = String(login.body.access_token);
  const frogSleepRefreshToken = String(login.body.refresh_token);

  await runtime.services.appRegistryService.ensureMembership("ai_novel", "user_alice");
  const aiNovelSession = await runtime.services.authService.issueSession("user_alice", "ai_novel");
  runtime.database.feedbackRecords.push({
    id: "feedback_ai_keep",
    appId: "ai_novel",
    userId: "user_alice",
    message: "Keep this AI Novel feedback.",
    messageHash: "hash_feedback_ai_keep",
    status: "new",
    metadata: {},
    attachmentCount: 0,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  });

  await runtime.database.upsertFrogSleepDevice({
    id: "device_delete_a",
    appId: "frogsleep",
    userId: "user_alice",
    platform: "ios",
    pushToken: "delete_push_token",
    pushEnabled: true,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  });
  await runtime.database.insertFrogSleepEntity({
    id: "sleep_invite_delete_a",
    appId: "frogsleep",
    kind: "sleep_invite",
    ownerUserId: "user_alice",
    partnerUserId: "user_bob",
    status: "pending",
    payload: {},
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  });
  await runtime.database.insertFrogSleepEntity({
    id: "other_app_invite_keep",
    appId: "app_a",
    kind: "sleep_invite",
    ownerUserId: "user_alice",
    partnerUserId: "user_bob",
    status: "pending",
    payload: {},
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  });

  const rejected = await runtime.app.handle({
    method: "DELETE",
    path: "/v1/me/account",
    headers: {
      authorization: `Bearer ${token}`,
    },
    body: {
      confirmation: "delete",
    },
    requestId: "req_frogsleep_delete_account_bad_confirmation",
  } as never);
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.body.code, "AUTH_ACCOUNT_DELETE_CONFIRMATION_INVALID");
  assert.equal(runtime.database.findAppUser("frogsleep", "user_alice")?.status, "ACTIVE");

  const response = await runtime.app.handle({
    method: "DELETE",
    path: "/v1/me/account",
    headers: {
      authorization: `Bearer ${token}`,
    },
    body: {
      confirmation: "DELETE",
    },
    requestId: "req_frogsleep_delete_account",
  } as never);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "deleted");
  assert.equal(response.body.deleted, true);
  assert.equal(response.body.data.deleted, true);
  assert.equal(runtime.database.findAppUser("frogsleep", "user_alice")?.status, "DELETED");
  assert.equal(runtime.database.findAppUser("ai_novel", "user_alice")?.status, "ACTIVE");
  assert.equal(runtime.database.findAppUser("app_a", "user_alice")?.status, "ACTIVE");
  assert.equal(runtime.database.findUserById("user_alice")?.status, "ACTIVE");
  assert.equal(runtime.database.listFrogSleepDevices({ appId: "frogsleep", userId: "user_alice", includeDeleted: true }).length, 0);
  assert.equal(runtime.database.listFrogSleepEntities({ appId: "frogsleep", kind: "sleep_invite", includeDeleted: true }).length, 0);
  assert.equal(runtime.database.listFrogSleepEntities({ appId: "app_a", kind: "sleep_invite", includeDeleted: true }).length, 1);
  assert.equal(runtime.database.feedbackRecords.some((item) => item.id === "feedback_ai_keep"), true);

  const frogSleepRefreshRecord = await runtime.services.refreshTokenStore.getByRawToken(frogSleepRefreshToken);
  assert.ok(frogSleepRefreshRecord?.revokedAt);
  const aiNovelRefreshRecord = await runtime.services.refreshTokenStore.getByRawToken(aiNovelSession.refreshToken);
  assert.ok(aiNovelRefreshRecord);
  assert.equal(aiNovelRefreshRecord.revokedAt, undefined);
});

test("FrogSleep refresh and logout use shared session storage", async () => {
  const runtime = await createTestRuntime();

  const login = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/password/login",
    headers: {},
    body: {
      account: "alice@example.com",
      password: "Password1234",
    },
    requestId: "req_frogsleep_refresh_login",
  } as never);

  const refreshResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/token/refresh",
    headers: {},
    body: {
      refresh_token: login.body.data.refresh_token,
    },
    requestId: "req_frogsleep_refresh",
  } as never);
  assert.equal(refreshResponse.statusCode, 200);
  assert.equal(refreshResponse.body.app_id, "frogsleep");
  assert.notEqual(refreshResponse.body.access_token, login.body.access_token);
  assert.equal(refreshResponse.body.data.app_id, "frogsleep");
  assert.notEqual(refreshResponse.body.data.access_token, login.body.data.access_token);

  const logoutResponse = await runtime.app.handle({
    method: "POST",
    path: "/v1/auth/logout",
    headers: {
      authorization: `Bearer ${refreshResponse.body.data.access_token}`,
    },
    body: {
      refresh_token: refreshResponse.body.data.refresh_token,
    },
    requestId: "req_frogsleep_logout",
  } as never);
  assert.equal(logoutResponse.statusCode, 200);
  assert.equal(logoutResponse.body.status, "ok");
  assert.equal(logoutResponse.body.revoked, 1);
  assert.equal(logoutResponse.body.data.revoked, 1);
});

test("existing Zook auth route remains available after FrogSleep auth compatibility", async () => {
  const runtime = await createTestRuntime();

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login",
    headers: {},
    body: {
      appId: "app_a",
      account: "alice@example.com",
      password: "Password1234",
      clientType: "app",
    },
    requestId: "req_existing_zook_auth_after_frogsleep",
  } as never);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.user.id, "user_alice");
  assert.equal(typeof response.body.data.accessToken, "string");
});
