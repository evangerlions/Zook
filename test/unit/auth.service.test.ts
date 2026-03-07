import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";

test("auth service auto-joins users for AUTO apps and assigns the default role", () => {
  const runtime = createApplication();

  const session = runtime.services.authService.login({
    appId: "app_a",
    account: "bob@example.com",
    password: "Password1234",
  });

  assert.equal(session.appId, "app_a");
  assert.ok(session.accessToken);
  assert.ok(session.refreshToken);
  assert.ok(runtime.database.findAppUser("app_a", "user_bob"));
  assert.ok(
    runtime.database.userRoles.some(
      (item) =>
        item.appId === "app_a" &&
        item.userId === "user_bob" &&
        item.roleId === "role_app_a_member",
    ),
  );
});

test("auth service rejects first-login into INVITE_ONLY apps", () => {
  const runtime = createApplication();

  assert.throws(
    () =>
      runtime.services.authService.login({
        appId: "app_b",
        account: "bob@example.com",
        password: "Password1234",
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "APP_JOIN_INVITE_REQUIRED",
  );
});

test("auth service rotates refresh tokens and revokes them on logout", () => {
  const runtime = createApplication();
  const firstSession = runtime.services.authService.login({
    appId: "app_a",
    account: "alice@example.com",
    password: "Password1234",
  });

  const secondSession = runtime.services.authService.refresh({
    appId: "app_a",
    refreshToken: firstSession.refreshToken,
  });

  assert.notEqual(secondSession.refreshToken, firstSession.refreshToken);
  const auth = runtime.services.tokenService.verifyAccessToken(secondSession.accessToken);
  const revoked = runtime.services.authService.logout(
    {
      appId: "app_a",
      scope: "current",
      refreshToken: secondSession.refreshToken,
    },
    auth,
  );

  assert.equal(revoked, 1);
  assert.throws(
    () =>
      runtime.services.authService.refresh({
        appId: "app_a",
        refreshToken: secondSession.refreshToken,
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_REFRESH_TOKEN_REVOKED",
  );
});
