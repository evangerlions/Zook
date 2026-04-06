import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";

function extractScanToken(qrContent: string): string {
  return new URL(qrContent).searchParams.get("scanToken") ?? "";
}

test("qr login APIs create a session, confirm it on mobile, and let PC poll once", async () => {
  const runtime = await createApplication();

  const createResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/qr-logins",
    headers: {},
    body: {
      appId: "app_a",
    },
  });

  assert.equal(createResponse.statusCode, 200);
  assert.equal(createResponse.body.code, "OK");
  assert.ok(typeof createResponse.body.data.loginId === "string");
  assert.ok(typeof createResponse.body.data.pollToken === "string");
  assert.ok(typeof createResponse.body.data.qrContent === "string");

  const loginId = createResponse.body.data.loginId;
  const pollToken = createResponse.body.data.pollToken;
  const scanToken = extractScanToken(createResponse.body.data.qrContent);
  assert.ok(scanToken);

  const pendingResponse = await runtime.app.handle({
    method: "GET",
    path: `/api/v1/auth/qr-logins/${loginId}`,
    headers: {},
    query: {
      appId: "app_a",
      pollToken,
    },
  });

  assert.equal(pendingResponse.statusCode, 200);
  assert.deepEqual(pendingResponse.body.data, {
    status: "PENDING",
    expiresInSeconds: 120,
    pollIntervalMs: 2000,
  });

  const mobileAccessToken = runtime.services.tokenService.issueAccessToken("user_alice", "app_a");
  const confirmResponse = await runtime.app.handle({
    method: "POST",
    path: `/api/v1/auth/qr-logins/${loginId}/confirm`,
    headers: {
      authorization: `Bearer ${mobileAccessToken}`,
    },
    body: {
      appId: "app_a",
      scanToken,
    },
  });

  assert.equal(confirmResponse.statusCode, 200);
  assert.deepEqual(confirmResponse.body.data, {
    confirmed: true,
  });

  const completedResponse = await runtime.app.handle({
    method: "GET",
    path: `/api/v1/auth/qr-logins/${loginId}`,
    headers: {},
    query: {
      appId: "app_a",
      pollToken,
    },
  });

  assert.equal(completedResponse.statusCode, 200);
  assert.equal(completedResponse.body.data.status, "CONFIRMED");
  assert.ok(typeof completedResponse.body.data.accessToken === "string");
  assert.equal(completedResponse.body.data.user.id, "user_alice");
  assert.equal(completedResponse.body.data.user.name, "alice");
  assert.equal(completedResponse.body.data.user.email, "alice@example.com");
  assert.equal(completedResponse.body.data.user.avatarUrl, null);
  assert.equal(completedResponse.body.data.user.hasPassword, true);
  assert.ok(typeof completedResponse.headers?.["Set-Cookie"] === "string");

  const secondPollResponse = await runtime.app.handle({
    method: "GET",
    path: `/api/v1/auth/qr-logins/${loginId}`,
    headers: {},
    query: {
      appId: "app_a",
      pollToken,
    },
  });

  assert.equal(secondPollResponse.statusCode, 409);
  assert.equal(secondPollResponse.body.code, "AUTH_QR_LOGIN_ALREADY_USED");
});

test("qr login rejects repeated confirmation with the same QR code", async () => {
  const runtime = await createApplication();
  const baseTime = new Date("2026-03-20T10:00:00+08:00");
  const created = await runtime.services.qrLoginService.createSession({ appId: "app_a" }, baseTime);
  const scanToken = extractScanToken(created.qrContent);

  const first = await runtime.services.qrLoginService.confirm(
    {
      appId: "app_a",
      loginId: created.loginId,
      scanToken,
      userId: "user_alice",
    },
    new Date(baseTime.getTime() + 5 * 1000),
  );
  assert.equal(first.confirmed, true);

  await assert.rejects(
    () =>
      runtime.services.qrLoginService.confirm(
        {
          appId: "app_a",
          loginId: created.loginId,
          scanToken,
          userId: "user_alice",
        },
        new Date(baseTime.getTime() + 10 * 1000),
      ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_QR_LOGIN_ALREADY_USED",
  );
});

test("qr login session expires before mobile confirmation", async () => {
  const runtime = await createApplication();
  const baseTime = new Date("2026-03-20T11:00:00+08:00");
  const created = await runtime.services.qrLoginService.createSession({ appId: "app_a" }, baseTime);
  const scanToken = extractScanToken(created.qrContent);

  await assert.rejects(
    () =>
      runtime.services.qrLoginService.confirm(
        {
          appId: "app_a",
          loginId: created.loginId,
          scanToken,
          userId: "user_alice",
        },
        new Date(baseTime.getTime() + 121 * 1000),
      ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_QR_LOGIN_EXPIRED",
  );
});

test("qr login confirm rejects app scope mismatches from mobile auth", async () => {
  const runtime = await createApplication();
  const created = await runtime.services.qrLoginService.createSession({ appId: "app_a" });
  const scanToken = extractScanToken(created.qrContent);
  const mismatchedAccessToken = runtime.services.tokenService.issueAccessToken("user_alice", "app_b");

  const response = await runtime.app.handle({
    method: "POST",
    path: `/api/v1/auth/qr-logins/${created.loginId}/confirm`,
    headers: {
      authorization: `Bearer ${mismatchedAccessToken}`,
    },
    body: {
      appId: "app_a",
      scanToken,
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, "AUTH_APP_SCOPE_MISMATCH");
});

test("qr login does not issue refresh tokens before PC polling completes", async () => {
  const runtime = await createApplication();
  const created = await runtime.services.qrLoginService.createSession({ appId: "app_a" });
  const scanToken = extractScanToken(created.qrContent);

  await runtime.services.qrLoginService.confirm({
    appId: "app_a",
    loginId: created.loginId,
    scanToken,
    userId: "user_alice",
  });

  const refreshTokens = await runtime.services.refreshTokenStore.listByUserAndApp("app_a", "user_alice");
  assert.deepEqual(refreshTokens, []);
});
