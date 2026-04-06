import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";

test("password login returns user profile, refresh keeps user profile, and users/me returns current user", async () => {
  const runtime = await createApplication();

  const loginResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login",
    headers: {},
    body: {
      appId: "app_a",
      account: "alice@example.com",
      password: "Password1234",
      clientType: "app",
    },
    ipAddress: "198.51.100.10",
  });

  assert.equal(loginResponse.statusCode, 200);
  assert.ok(typeof loginResponse.body.data.accessToken === "string");
  assert.ok(typeof loginResponse.body.data.refreshToken === "string");
  assert.deepEqual(loginResponse.body.data.user, {
    id: "user_alice",
    name: "alice",
    email: "alice@example.com",
    phone: undefined,
    avatarUrl: null,
    hasPassword: true,
  });

  const meResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/users/me",
    headers: {
      authorization: `Bearer ${loginResponse.body.data.accessToken}`,
      "x-app-id": "app_a",
    },
  });

  assert.equal(meResponse.statusCode, 200);
  assert.equal(meResponse.body.data.appId, "app_a");
  assert.deepEqual(meResponse.body.data.user, {
    id: "user_alice",
    name: "alice",
    email: "alice@example.com",
    phone: undefined,
    avatarUrl: null,
    hasPassword: true,
  });

  const refreshResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/refresh",
    headers: {},
    body: {
      appId: "app_a",
      refreshToken: loginResponse.body.data.refreshToken,
      clientType: "app",
    },
  });

  assert.equal(refreshResponse.statusCode, 200);
  assert.ok(typeof refreshResponse.body.data.accessToken === "string");
  assert.ok(typeof refreshResponse.body.data.refreshToken === "string");
  assert.deepEqual(refreshResponse.body.data.user, {
    id: "user_alice",
    name: "alice",
    email: "alice@example.com",
    phone: undefined,
    avatarUrl: null,
    hasPassword: true,
  });
});

test("users/me rejects X-App-Id mismatches against bearer scope", async () => {
  const runtime = await createApplication();
  const accessToken = runtime.services.tokenService.issueAccessToken("user_alice", "app_a");

  const response = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/users/me",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "x-app-id": "app_b",
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, "AUTH_APP_SCOPE_MISMATCH");
});

test("users/me rejects bearer tokens after the user loses app membership", async () => {
  const runtime = await createApplication();

  const loginResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login",
    headers: {},
    body: {
      appId: "app_a",
      account: "alice@example.com",
      password: "Password1234",
      clientType: "app",
    },
    ipAddress: "198.51.100.10",
  });

  const accessToken = loginResponse.body.data.accessToken;
  runtime.database.appUsers = runtime.database.appUsers.filter(
    (item) => !(item.appId === "app_a" && item.userId === "user_alice"),
  );

  const response = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/users/me",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "x-app-id": "app_a",
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, "APP_JOIN_INVITE_REQUIRED");
});
