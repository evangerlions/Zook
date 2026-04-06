import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";
import type { RegistrationEmailSender } from "../../src/services/tencent-ses-registration-email.service.ts";

interface SentVerificationEmail {
  appName: string;
  email: string;
  code: string;
  locale: string;
  region: "ap-guangzhou" | "ap-hongkong";
  expireMinutes: number;
  templateName?: string;
}

function createFakeSender(sent: SentVerificationEmail[]): RegistrationEmailSender {
  return {
    async sendTemplateEmail() {
      return {
        provider: "tencent_ses",
      };
    },
    async sendVerificationCode(command) {
      sent.push(command);
      return {
        provider: "tencent_ses",
      };
    },
  };
}

test("register email verification codes survive runtime restarts when KV storage is shared", async () => {
  const sent: SentVerificationEmail[] = [];
  const firstRuntime = await createApplication({
    registrationCodeGenerator: () => "123456",
    registrationEmailSender: createFakeSender(sent),
  });
  const sharedKvManager = firstRuntime.services.kvManager;

  await firstRuntime.services.authService.registerEmailCode(
    {
      appId: "app_a",
      email: "persisted-register@example.com",
      ipAddress: "203.0.113.40",
      locale: "zh-CN",
      region: "ap-guangzhou",
    },
    new Date("2026-03-29T10:00:00+08:00"),
  );

  const secondRuntime = await createApplication({
    kvManager: sharedKvManager,
    registrationEmailSender: createFakeSender([]),
  });
  const session = await secondRuntime.services.authService.register(
    {
      appId: "app_a",
      email: "persisted-register@example.com",
      password: "Password1234",
      emailCode: "123456",
      ipAddress: "203.0.113.40",
    },
    new Date("2026-03-29T10:01:00+08:00"),
  );

  assert.ok(session.accessToken);
  assert.equal(secondRuntime.database.findUserByAccount("persisted-register@example.com")?.passwordAlgo, "scrypt");
});

test("logout all invalidates the current access token immediately", async () => {
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
    ipAddress: "198.51.100.50",
  });

  assert.equal(loginResponse.statusCode, 200);

  const logoutResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/logout",
    headers: {
      authorization: `Bearer ${loginResponse.body.data.accessToken}`,
      "x-app-id": "app_a",
    },
    body: {
      appId: "app_a",
      scope: "all",
      refreshToken: loginResponse.body.data.refreshToken,
    },
  });

  assert.equal(logoutResponse.statusCode, 200);
  assert.equal(logoutResponse.body.data.revoked >= 1, true);

  const meResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/users/me",
    headers: {
      authorization: `Bearer ${loginResponse.body.data.accessToken}`,
      "x-app-id": "app_a",
    },
  });

  assert.equal(meResponse.statusCode, 401);
  assert.equal(meResponse.body.code, "AUTH_INVALID_TOKEN");
});

test("password reset upgrades email-code-only accounts into password accounts", async () => {
  const sent: SentVerificationEmail[] = [];
  let nextCode = "111111";
  const runtime = await createApplication({
    registrationCodeGenerator: () => nextCode,
    registrationEmailSender: createFakeSender(sent),
  });

  await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login/email-code",
    headers: {
      "x-app-locale": "en-US",
      "x-app-country-code": "US",
    },
    body: {
      appId: "app_a",
      email: "setup-password@example.com",
    },
    ipAddress: "198.51.100.60",
  });

  const emailLoginResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login/email",
    headers: {
      "x-app-locale": "en-US",
      "x-app-country-code": "US",
    },
    body: {
      appId: "app_a",
      email: "setup-password@example.com",
      emailCode: "111111",
      clientType: "app",
    },
    ipAddress: "198.51.100.60",
  });

  assert.equal(emailLoginResponse.statusCode, 200);
  assert.equal(runtime.database.findUserByAccount("setup-password@example.com")?.passwordAlgo, "email-code-only");

  nextCode = "222222";
  const sendPasswordCodeResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/password/email-code",
    headers: {
      "x-app-locale": "en-US",
      "x-app-country-code": "US",
    },
    body: {
      appId: "app_a",
      email: "setup-password@example.com",
    },
    ipAddress: "198.51.100.60",
  });

  assert.equal(sendPasswordCodeResponse.statusCode, 200);

  const resetResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/password/reset",
    headers: {},
    body: {
      appId: "app_a",
      email: "setup-password@example.com",
      emailCode: "222222",
      password: "Password5678",
      clientType: "app",
    },
    ipAddress: "198.51.100.60",
  });

  assert.equal(resetResponse.statusCode, 200);
  assert.ok(typeof resetResponse.body.data.accessToken === "string");
  assert.ok(typeof resetResponse.body.data.refreshToken === "string");
  assert.equal(runtime.database.findUserByAccount("setup-password@example.com")?.passwordAlgo, "scrypt");

  const passwordLoginResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login",
    headers: {},
    body: {
      appId: "app_a",
      account: "setup-password@example.com",
      password: "Password5678",
      clientType: "app",
    },
    ipAddress: "198.51.100.60",
  });

  assert.equal(passwordLoginResponse.statusCode, 200);
  assert.equal(sent.at(-1)?.templateName, "verify-code");
});

test("logged-in email-code-only users can set a password directly", async () => {
  const sent: SentVerificationEmail[] = [];
  const runtime = await createApplication({
    registrationCodeGenerator: () => "333333",
    registrationEmailSender: createFakeSender(sent),
  });

  await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login/email-code",
    headers: {
      "x-app-locale": "en-US",
      "x-app-country-code": "US",
    },
    body: {
      appId: "app_a",
      email: "set-direct@example.com",
    },
    ipAddress: "198.51.100.61",
  });

  const emailLoginResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login/email",
    headers: {
      "x-app-locale": "en-US",
      "x-app-country-code": "US",
    },
    body: {
      appId: "app_a",
      email: "set-direct@example.com",
      emailCode: "333333",
      clientType: "app",
    },
    ipAddress: "198.51.100.61",
  });

  assert.equal(emailLoginResponse.statusCode, 200);
  assert.equal(runtime.database.findUserByAccount("set-direct@example.com")?.passwordAlgo, "email-code-only");

  const setPasswordResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/password/set",
    headers: {
      authorization: `Bearer ${emailLoginResponse.body.data.accessToken}`,
      "x-app-id": "app_a",
    },
    body: {
      appId: "app_a",
      password: "Password6789",
      clientType: "app",
    },
    ipAddress: "198.51.100.61",
  });

  assert.equal(setPasswordResponse.statusCode, 200);
  assert.ok(typeof setPasswordResponse.body.data.accessToken === "string");
  assert.ok(typeof setPasswordResponse.body.data.refreshToken === "string");
  assert.equal(runtime.database.findUserByAccount("set-direct@example.com")?.passwordAlgo, "scrypt");

  const staleMeResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/users/me",
    headers: {
      authorization: `Bearer ${emailLoginResponse.body.data.accessToken}`,
      "x-app-id": "app_a",
    },
  });

  assert.equal(staleMeResponse.statusCode, 401);
  assert.equal(staleMeResponse.body.code, "AUTH_INVALID_TOKEN");

  const passwordLoginResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login",
    headers: {},
    body: {
      appId: "app_a",
      account: "set-direct@example.com",
      password: "Password6789",
      clientType: "app",
    },
    ipAddress: "198.51.100.61",
  });

  assert.equal(passwordLoginResponse.statusCode, 200);
});

test("set password rejects accounts that already have a password", async () => {
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
    ipAddress: "198.51.100.71",
  });

  assert.equal(loginResponse.statusCode, 200);

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/password/set",
    headers: {
      authorization: `Bearer ${loginResponse.body.data.accessToken}`,
      "x-app-id": "app_a",
    },
    body: {
      appId: "app_a",
      password: "Password8888",
      clientType: "app",
    },
    ipAddress: "198.51.100.71",
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.code, "AUTH_PASSWORD_ALREADY_SET");
});

test("password change returns a new session and revokes the previous access token", async () => {
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
    ipAddress: "198.51.100.70",
  });

  assert.equal(loginResponse.statusCode, 200);

  const changeResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/password/change",
    headers: {
      authorization: `Bearer ${loginResponse.body.data.accessToken}`,
      "x-app-id": "app_a",
    },
    body: {
      appId: "app_a",
      currentPassword: "Password1234",
      newPassword: "Password9999",
      clientType: "app",
    },
    ipAddress: "198.51.100.70",
  });

  assert.equal(changeResponse.statusCode, 200);
  assert.ok(typeof changeResponse.body.data.accessToken === "string");
  assert.ok(typeof changeResponse.body.data.refreshToken === "string");

  const staleMeResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/users/me",
    headers: {
      authorization: `Bearer ${loginResponse.body.data.accessToken}`,
      "x-app-id": "app_a",
    },
  });

  assert.equal(staleMeResponse.statusCode, 401);
  assert.equal(staleMeResponse.body.code, "AUTH_INVALID_TOKEN");

  const oldPasswordLogin = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login",
    headers: {},
    body: {
      appId: "app_a",
      account: "alice@example.com",
      password: "Password1234",
      clientType: "app",
    },
    ipAddress: "198.51.100.70",
  });
  assert.equal(oldPasswordLogin.statusCode, 401);

  const newPasswordLogin = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login",
    headers: {},
    body: {
      appId: "app_a",
      account: "alice@example.com",
      password: "Password9999",
      clientType: "app",
    },
    ipAddress: "198.51.100.70",
  });
  assert.equal(newPasswordLogin.statusCode, 200);
});

test("api runtime startup requires an explicit access token secret", async () => {
  const previousSecret = process.env.AUTH_ACCESS_TOKEN_SECRET;
  delete process.env.AUTH_ACCESS_TOKEN_SECRET;

  try {
    await assert.rejects(
      () => createApplication({ serviceName: "api" }),
      /AUTH_ACCESS_TOKEN_SECRET must be configured/,
    );
  } finally {
    if (typeof previousSecret === "string") {
      process.env.AUTH_ACCESS_TOKEN_SECRET = previousSecret;
    }
  }
});
