import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";

async function loginAlice(runtime: Awaited<ReturnType<typeof createApplication>>) {
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
    ipAddress: "198.51.100.80",
  });

  assert.equal(response.statusCode, 200);
  return response.body.data;
}

test("users/me/delete marks membership deleted, clears app-scoped runtime data, and revokes sessions", async () => {
  const runtime = await createApplication();
  const session = await loginAlice(runtime);

  runtime.database.analyticsEvents.push({
    id: "evt_alice_a",
    appId: "app_a",
    userId: "user_alice",
    platform: "web",
    sessionId: "session_a",
    pageKey: "settings",
    eventName: "page_view",
    occurredAt: "2026-04-01T00:00:00.000Z",
    receivedAt: "2026-04-01T00:00:00.000Z",
    metadata: {},
  });
  runtime.database.analyticsEvents.push({
    id: "evt_alice_b",
    appId: "app_b",
    userId: "user_alice",
    platform: "web",
    sessionId: "session_b",
    pageKey: "settings",
    eventName: "page_view",
    occurredAt: "2026-04-01T00:00:00.000Z",
    receivedAt: "2026-04-01T00:00:00.000Z",
    metadata: {},
  });
  runtime.database.files.push({
    id: "file_alice_a",
    appId: "app_a",
    ownerUserId: "user_alice",
    storageKey: "app_a/user_alice/avatar.png",
    mimeType: "image/png",
    sizeBytes: 42,
    status: "CONFIRMED",
    createdAt: "2026-04-01T00:00:00.000Z",
  });
  runtime.database.notificationJobs.push({
    id: "job_alice_a",
    appId: "app_a",
    recipientUserId: "user_alice",
    channel: "email",
    payload: {},
    status: "PENDING",
    retryCount: 0,
  });
  runtime.database.clientLogUploadTasks.push({
    id: "task_alice_a",
    appId: "app_a",
    userId: "user_alice",
    keyId: "local-k1",
    status: "PENDING",
    createdAt: "2026-04-01T00:00:00.000Z",
  });
  runtime.database.clientLogUploads.push({
    id: "upload_alice_a",
    taskId: "task_alice_a",
    appId: "app_a",
    userId: "user_alice",
    keyId: "local-k1",
    encryption: "aes-256-gcm",
    contentEncoding: "ndjson+gzip",
    nonceBase64: "nonce",
    encryptedBytes: 10,
    acceptedCount: 1,
    rejectedCount: 0,
    uploadedAt: "2026-04-01T00:00:00.000Z",
  });
  runtime.database.clientLogLines.push({
    id: "line_alice_a",
    uploadId: "upload_alice_a",
    taskId: "task_alice_a",
    appId: "app_a",
    userId: "user_alice",
    payload: {},
    createdAt: "2026-04-01T00:00:00.000Z",
  });
  runtime.database.auditLogs.push({
    id: "audit_keep",
    appId: "app_a",
    actorUserId: "user_alice",
    action: "test.audit.keep",
    resourceType: "user",
    resourceOwnerUserId: "user_alice",
    payload: {},
    createdAt: "2026-04-01T00:00:00.000Z",
  });

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/users/me/delete",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-app-id": "app_a",
    },
    body: {
      appId: "app_a",
      confirmation: "DELETE",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.data, {
    deleted: true,
    revokedSessions: 1,
  });
  assert.equal(runtime.database.findAppUser("app_a", "user_alice")?.status, "DELETED");
  assert.equal(runtime.database.findUserById("user_alice")?.status, "ACTIVE");
  assert.equal(runtime.database.userRoles.some((item) => item.appId === "app_a" && item.userId === "user_alice"), false);
  assert.equal(runtime.database.analyticsEvents.some((item) => item.id === "evt_alice_a"), false);
  assert.equal(runtime.database.analyticsEvents.some((item) => item.id === "evt_alice_b"), true);
  assert.equal(runtime.database.files.some((item) => item.id === "file_alice_a"), false);
  assert.equal(runtime.database.notificationJobs.some((item) => item.id === "job_alice_a"), false);
  assert.equal(runtime.database.clientLogUploadTasks.some((item) => item.id === "task_alice_a"), false);
  assert.equal(runtime.database.clientLogUploads.some((item) => item.id === "upload_alice_a"), false);
  assert.equal(runtime.database.clientLogLines.some((item) => item.id === "line_alice_a"), false);
  assert.equal(runtime.database.auditLogs.some((item) => item.id === "audit_keep"), true);

  const meResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/users/me",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-app-id": "app_a",
    },
  });
  assert.equal(meResponse.statusCode, 401);
  assert.equal(meResponse.body.code, "AUTH_INVALID_TOKEN");

  const refreshResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/refresh",
    headers: {},
    body: {
      appId: "app_a",
      refreshToken: session.refreshToken,
      clientType: "app",
    },
  });
  assert.equal(refreshResponse.statusCode, 401);
  assert.equal(refreshResponse.body.code, "AUTH_REFRESH_TOKEN_REVOKED");
});

test("deleted app membership prevents automatic rejoin for the same account", async () => {
  const runtime = await createApplication();
  const session = await loginAlice(runtime);

  const deleteResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/users/me/delete",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-app-id": "app_a",
    },
    body: {
      appId: "app_a",
      confirmation: "DELETE",
    },
  });
  assert.equal(deleteResponse.statusCode, 200);

  const loginAgainResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login",
    headers: {},
    body: {
      appId: "app_a",
      account: "alice@example.com",
      password: "Password1234",
      clientType: "app",
    },
    ipAddress: "198.51.100.81",
  });

  assert.equal(loginAgainResponse.statusCode, 403);
  assert.equal(loginAgainResponse.body.code, "APP_MEMBER_DELETED");
});

test("users/me/delete requires DELETE confirmation with localized public error", async () => {
  const runtime = await createApplication();
  const session = await loginAlice(runtime);

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/users/me/delete",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-app-id": "app_a",
      "accept-language": "zh-CN",
    },
    body: {
      appId: "app_a",
      confirmation: "delete",
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "AUTH_ACCOUNT_DELETE_CONFIRMATION_INVALID");
  assert.equal(response.body.message, "请输入 DELETE 以确认注销账号。");
  assert.equal(runtime.database.findAppUser("app_a", "user_alice")?.status, "ACTIVE");
});
