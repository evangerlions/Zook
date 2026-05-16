import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";

test("auth service auto-joins users for AUTO apps and assigns the default role", async () => {
  const runtime = await createApplication();

  const session = await runtime.services.authService.login({
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

test("auth service rejects first-login into INVITE_ONLY apps", async () => {
  const runtime = await createApplication();

  await assert.rejects(
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

test("auth service rotates refresh tokens and revokes them on logout", async () => {
  const runtime = await createApplication();
  const firstSession = await runtime.services.authService.login({
    appId: "app_a",
    account: "alice@example.com",
    password: "Password1234",
  });

  const secondSession = await runtime.services.authService.refresh({
    appId: "app_a",
    refreshToken: firstSession.refreshToken,
  });

  assert.notEqual(secondSession.refreshToken, firstSession.refreshToken);
  const auth = runtime.services.tokenService.verifyAccessToken(secondSession.accessToken);
  const revoked = await runtime.services.authService.logout(
    {
      appId: "app_a",
      scope: "current",
      refreshToken: secondSession.refreshToken,
    },
    auth,
  );

  assert.equal(revoked, 1);
  await assert.rejects(
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

test("auth service keeps refresh tokens usable across application restarts when KV storage is shared", async () => {
  const firstRuntime = await createApplication();
  const sharedKvManager = firstRuntime.services.kvManager;
  const firstSession = await firstRuntime.services.authService.login({
    appId: "app_a",
    account: "alice@example.com",
    password: "Password1234",
  });

  const secondRuntime = await createApplication({
    kvManager: sharedKvManager,
  });
  const refreshed = await secondRuntime.services.authService.refresh({
    appId: "app_a",
    refreshToken: firstSession.refreshToken,
  });

  assert.ok(refreshed.accessToken);
  assert.notEqual(refreshed.refreshToken, firstSession.refreshToken);
});

test("auth service issues web refresh cookies with a 60 day lifetime", async () => {
  const runtime = await createApplication();
  const cookie = runtime.services.authService.buildRefreshCookie("refresh-token", "web");

  assert.ok(cookie);
  assert.match(cookie, /Max-Age=5184000/);
  assert.match(cookie, /SameSite=None/);
  assert.match(cookie, /Secure/);
});

test("auth service can mark web refresh cookies as Secure", async () => {
  const runtime = await createApplication({
    secureRefreshCookie: true,
  });
  const cookie = runtime.services.authService.buildRefreshCookie("refresh-token", "web");

  assert.ok(cookie);
  assert.match(cookie, /Secure/);
  assert.match(runtime.services.authService.buildClearRefreshCookie(), /Secure/);
});

test("auth service allows overriding refresh cookie SameSite strategy", async () => {
  const runtime = await createApplication({
    refreshCookieSameSite: "Lax",
    secureRefreshCookie: false,
  });
  const cookie = runtime.services.authService.buildRefreshCookie("refresh-token", "web");

  assert.ok(cookie);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, /Secure/);
});

test("password login lock survives application restart when KV storage is shared", async () => {
  const firstRuntime = await createApplication();
  const sharedKvManager = firstRuntime.services.kvManager;

  for (let index = 0; index < 10; index += 1) {
    await assert.rejects(
      () =>
        firstRuntime.services.authService.login({
          appId: "app_a",
          account: "alice@example.com",
          password: "wrong-password",
        }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "AUTH_INVALID_CREDENTIAL",
    );
  }

  const secondRuntime = await createApplication({
    kvManager: sharedKvManager,
  });

  await assert.rejects(
    () =>
      secondRuntime.services.authService.login({
        appId: "app_a",
        account: "alice@example.com",
        password: "Password1234",
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_LOGIN_TEMPORARILY_LOCKED",
  );
});
