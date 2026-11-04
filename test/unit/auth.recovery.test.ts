import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";
import { findLocalEmailLoginTestAccount } from "../../src/modules/auth/local-email-login-test-accounts.ts";
import { InMemoryKVBackend } from "../../src/infrastructure/kv/kv-manager.ts";

test("fixed email test codes require explicit local mode and are disabled in production", () => {
  const original = { app: process.env.APP_ENV, node: process.env.NODE_ENV };
  try {
    for (const [app, node] of [["online", "production"], ["", "production"], ["online", "development"], ["", ""]]) {
      process.env.APP_ENV = app; process.env.NODE_ENV = node;
      for (const ip of ["unknown", "127.0.0.1", "::1", "198.51.100.20"]) {
        assert.equal(findLocalEmailLoginTestAccount("evangerlions@gmail.com", ip), undefined);
      }
    }
    process.env.APP_ENV = "local"; process.env.NODE_ENV = "development";
    assert.ok(findLocalEmailLoginTestAccount("evangerlions@gmail.com", "127.0.0.1"));
    process.env.NODE_ENV = "production";
    assert.equal(findLocalEmailLoginTestAccount("evangerlions@gmail.com", "127.0.0.1"), undefined);
  } finally {
    if (original.app === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = original.app;
    if (original.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original.node;
  }
});

test("refresh remains retryable after a transient user lookup failure", async (t) => {
  const runtime = await createApplication();
  const auth = runtime.services.authService;
  const session = await auth.login({ appId: "app_a", account: "alice@example.com", password: "Password1234" });
  const failure = t.mock.method(runtime.database, "findUserById", async () => { throw new Error("temporary database failure"); });
  await assert.rejects(() => auth.refresh({ appId: "app_a", refreshToken: session.refreshToken }), /temporary database failure/);
  failure.mock.restore();
  const refreshed = await auth.refresh({ appId: "app_a", refreshToken: session.refreshToken });
  assert.notEqual(refreshed.refreshToken, session.refreshToken);
});

test("changing the shared password invalidates old sessions in every app", async () => {
  const runtime = await createApplication();
  const auth = runtime.services.authService;
  const old = await auth.login({ appId: "app_b", account: "alice@example.com", password: "Password1234" });
  const next = await auth.changePassword({ appId: "app_a", userId: "user_alice", currentPassword: "Password1234", newPassword: "Changed12345" });
  await assert.rejects(() => auth.assertAccessTokenActive(runtime.services.tokenService.verifyAccessToken(old.accessToken)));
  await assert.rejects(() => auth.refresh({ appId: "app_b", refreshToken: old.refreshToken }));
  await auth.assertAccessTokenActive(runtime.services.tokenService.verifyAccessToken(next.accessToken));
});

test("refresh remains retryable if response profile preparation fails", async (t) => {
  const runtime = await createApplication();
  const auth = runtime.services.authService;
  const session = await auth.login({ appId: "app_a", account: "alice@example.com", password: "Password1234" });
  const failure = t.mock.method(runtime.services.userService, "getProfile", async () => { throw new Error("temporary profile failure"); });
  const body = { appId: "app_a", refreshToken: session.refreshToken, clientType: "app" };
  const send = () => runtime.app.handle({ method: "POST", path: "/api/v1/auth/refresh", headers: {}, body });
  assert.equal((await send()).statusCode, 500);
  failure.mock.restore();
  assert.equal((await send()).statusCode, 200);
});

test("legacy tokens remain compatible until the first shared password change", async () => {
  const runtime = await createApplication();
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "app_a");
  const auth = runtime.services.tokenService.verifyAccessToken(token);
  await runtime.services.authService.assertAccessTokenActive(auth);
  await runtime.services.authService.changePassword({ appId: "app_a", userId: "user_alice", currentPassword: "Password1234", newPassword: "Changed12345" });
  await assert.rejects(() => runtime.services.authService.assertAccessTokenActive(auth));
});

test("shared password reset invalidates other apps without exposing the old sessions", async () => {
  const runtime = await createApplication({ registrationCodeGenerator: () => "123456" });
  const auth = runtime.services.authService;
  const old = await auth.login({ appId: "app_b", account: "alice@example.com", password: "Password1234" });
  const command = { appId: "app_a", email: "alice@example.com", ipAddress: "198.51.100.20", locale: "en", region: "ap-singapore" as const };
  await auth.sendPasswordCode(command);
  const next = await auth.resetPassword({ ...command, password: "Changed12345", emailCode: "123456" });
  await assert.rejects(() => auth.assertAccessTokenActive(runtime.services.tokenService.verifyAccessToken(old.accessToken)));
  await assert.rejects(() => auth.refresh({ appId: "app_b", refreshToken: old.refreshToken }));
  await auth.assertAccessTokenActive(runtime.services.tokenService.verifyAccessToken(next.accessToken));
});

test("failed atomic refresh commit preserves the previous token and indexes", async t => {
  const backend = new InMemoryKVBackend();
  const runtime = await createApplication({ kvBackend: backend });
  const auth = runtime.services.authService;
  const session = await auth.login({ appId: "app_a", account: "alice@example.com", password: "Password1234" });
  const before = await runtime.services.refreshTokenStore.listByUserAndApp("app_a", "user_alice");
  const failure = t.mock.method(backend, "applyAtomic", async () => { throw new Error("temporary Redis failure"); });
  await assert.rejects(() => auth.refresh({ appId: "app_a", refreshToken: session.refreshToken }), /temporary Redis failure/);
  assert.deepEqual(await runtime.services.refreshTokenStore.listByUserAndApp("app_a", "user_alice"), before);
  failure.mock.restore();
  assert.ok((await auth.refresh({ appId: "app_a", refreshToken: session.refreshToken })).accessToken);
});

test("registration rolls back the new identity when session persistence fails and preserves the code for retry", async (t) => {
  const runtime = await createApplication({ registrationCodeGenerator: () => "123456" });
  const auth = runtime.services.authService;
  const command = { appId: "app_a", email: "retry-registration@example.com", ipAddress: "198.51.100.20", locale: "en", region: "ap-singapore" as const };
  await auth.registerEmailCode(command);
  const failure = t.mock.method(runtime.services.refreshTokenStore, "create", async () => { throw new Error("temporary session storage failure"); });
  await assert.rejects(() => auth.register({ ...command, password: "Password1234", emailCode: "123456" }), /temporary session storage failure/);
  assert.equal(await runtime.database.findUserByAccount(command.email), undefined);
  failure.mock.restore();
  const session = await auth.register({ ...command, password: "Password1234", emailCode: "123456" });
  assert.ok(session.accessToken);
});

test("an email provider wait does not block another user's HTTP password login", async () => {
  let release!: () => void; let started!: () => void;
  const delivery = new Promise<void>(resolve => { release = resolve; });
  const sending = new Promise<void>(resolve => { started = resolve; });
  const runtime = await createApplication({ registrationEmailSender: {
    async sendTemplateEmail() { return { provider: "tencent_ses" as const }; },
    async sendVerificationCode() { started(); await delivery; return { provider: "tencent_ses" as const }; },
  } });
  const request = runtime.app.handle({ method: "POST", path: "/api/v1/auth/register/email-code", headers: {},
    ipAddress: "198.51.100.20", body: { appId: "app_a", email: "waiting@example.com" } });
  await sending;
  try {
    const result = await Promise.race([
      runtime.app.handle({ method: "POST", path: "/api/v1/auth/login", headers: {},
        body: { appId: "app_a", account: "alice@example.com", password: "Password1234", clientType: "app" } }),
      new Promise<undefined>(resolve => setTimeout(resolve, 1500)),
    ]);
    assert.equal(result?.statusCode, 200);
  } finally { release(); await request; }
});
