import assert from "node:assert/strict";
import test from "node:test";
import { AuthGuard } from "../../src/core/guards/auth.guard.ts";
import { TokenService } from "../../src/modules/auth/token.service.ts";

function createGuard(secret = "test-secret") {
  return new AuthGuard(new TokenService(secret));
}

// --- AuthGuard ---

test("AuthGuard accepts a valid Bearer token and attaches auth to request", () => {
  const guard = createGuard();
  const now = new Date("2026-04-13T10:00:00+08:00");
  const token = new TokenService("test-secret").issueAccessToken("user_1", "app_1", 1, now);

  const request = {
    method: "GET",
    path: "/api/v1/users/me",
    headers: { authorization: `Bearer ${token}` },
  } as Parameters<typeof guard.canActivate>[0];

  const ctx = guard.canActivate(request, now);
  assert.equal(ctx.userId, "user_1");
  assert.equal(ctx.appId, "app_1");
  assert.equal(request.auth, ctx);
});

test("AuthGuard rejects missing Authorization header", () => {
  const guard = createGuard();
  const request = {
    method: "GET",
    path: "/api/v1/users/me",
    headers: {},
  } as Parameters<typeof guard.canActivate>[0];

  assert.throws(
    () => guard.canActivate(request),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_BEARER_REQUIRED" &&
      error.statusCode === 401,
  );
});

test("AuthGuard rejects non-Bearer Authorization header", () => {
  const guard = createGuard();
  const request = {
    method: "GET",
    path: "/api/v1/users/me",
    headers: { authorization: "Basic dXNlcjpwYXNz" },
  } as Parameters<typeof guard.canActivate>[0];

  assert.throws(
    () => guard.canActivate(request),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_BEARER_REQUIRED",
  );
});

test("AuthGuard rejects a Bearer token with no value", () => {
  const guard = createGuard();
  const request = {
    method: "GET",
    path: "/api/v1/users/me",
    headers: { authorization: "Bearer " },
  } as Parameters<typeof guard.canActivate>[0];

  assert.throws(
    () => guard.canActivate(request),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_INVALID_TOKEN",
  );
});

test("AuthGuard case-insensitively reads the authorization header", () => {
  const guard = createGuard();
  const now = new Date("2026-04-13T10:00:00+08:00");
  const token = new TokenService("test-secret").issueAccessToken("user_1", "app_1", 1, now);

  const request = {
    method: "GET",
    path: "/api/v1/users/me",
    headers: { Authorization: `Bearer ${token}` },
  } as unknown as Parameters<typeof guard.canActivate>[0];

  const ctx = guard.canActivate(request, now);
  assert.equal(ctx.userId, "user_1");
});
