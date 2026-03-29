import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import type { GeoResolver } from "../../src/services/request-email-context.service.ts";
import { type RegistrationEmailSender } from "../../src/services/tencent-ses-registration-email.service.ts";

interface SentVerificationEmail {
  appName: string;
  email: string;
  code: string;
  locale: string;
  region: "ap-guangzhou" | "ap-hongkong";
  expireMinutes: number;
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

test("email-code login sends localized email, auto-creates account, and blocks password login for email-code-only users", async () => {
  const sent: SentVerificationEmail[] = [];
  const runtime = await createApplication({
    registrationCodeGenerator: () => "123456",
    registrationEmailSender: createFakeSender(sent),
  });

  const sendCodeResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login/email-code",
    headers: {
      "x-app-locale": "en-US",
      "x-app-country-code": "US",
    },
    body: {
      appId: "app_a",
      email: "new-login@example.com",
    },
    ipAddress: "198.51.100.10",
  });

  assert.equal(sendCodeResponse.statusCode, 200);
  assert.deepEqual(sendCodeResponse.body.data, {
    accepted: true,
    cooldownSeconds: 60,
    expiresInSeconds: 600,
  });
  assert.deepEqual(sent, [
    {
      appName: "App A",
      email: "new-login@example.com",
      code: "123456",
      locale: "en-US",
      region: "ap-hongkong",
      expireMinutes: 10,
      templateName: "verify-code",
    },
  ]);

  const loginResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login/email",
    headers: {
      "x-app-locale": "en-US",
      "x-app-country-code": "US",
    },
    body: {
      appId: "app_a",
      email: "new-login@example.com",
      emailCode: "123456",
      clientType: "app",
    },
    ipAddress: "198.51.100.10",
  });

  assert.equal(loginResponse.statusCode, 200);
  assert.ok(typeof loginResponse.body.data.accessToken === "string");
  assert.ok(typeof loginResponse.body.data.refreshToken === "string");

  const createdUser = runtime.database.findUserByAccount("new-login@example.com");
  assert.ok(createdUser);
  assert.equal(createdUser.passwordAlgo, "email-code-only");
  assert.ok(runtime.database.findAppUser("app_a", createdUser.id));
  assert.ok(
    runtime.database.userRoles.some((item) => item.appId === "app_a" && item.userId === createdUser.id),
  );
  assert.ok(
    runtime.database.auditLogs.some((item) => item.action === "auth.login.email_code" && item.appId === "app_a"),
  );
  assert.ok(
    runtime.database.auditLogs.some((item) => item.action === "auth.login.email" && item.resourceOwnerUserId === createdUser.id),
  );

  const passwordLoginResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login",
    headers: {},
    body: {
      appId: "app_a",
      account: "new-login@example.com",
      password: "Password1234",
      clientType: "app",
    },
    ipAddress: "198.51.100.10",
  });

  assert.equal(passwordLoginResponse.statusCode, 401);
  assert.equal(passwordLoginResponse.body.code, "AUTH_INVALID_CREDENTIAL");
});

test("email-code delivery uses trusted gateway country header before client country header and does not hit geo", async () => {
  const sent: SentVerificationEmail[] = [];
  let geoCalls = 0;
  const geoResolver: GeoResolver = {
    async resolveCountryCode() {
      geoCalls += 1;
      return "US";
    },
  };
  const runtime = await createApplication({
    registrationCodeGenerator: () => "654321",
    registrationEmailSender: createFakeSender(sent),
    geoResolver,
  });

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login/email-code",
    headers: {
      "x-country-code": "CN",
      "x-app-country-code": "US",
      "x-app-locale": "ja-JP",
      "accept-language": "en-US,en;q=0.8",
    },
    trustedProxy: true,
    body: {
      appId: "app_a",
      email: "priority@example.com",
    },
    ipAddress: "203.0.113.21",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(geoCalls, 0);
  assert.equal(sent[0]?.region, "ap-guangzhou");
  assert.equal(sent[0]?.locale, "ja-JP");
});

test("email-code delivery falls back to geo when country headers are absent", async () => {
  const sent: SentVerificationEmail[] = [];
  let geoCalls = 0;
  const geoResolver: GeoResolver = {
    async resolveCountryCode() {
      geoCalls += 1;
      return "US";
    },
  };
  const runtime = await createApplication({
    registrationCodeGenerator: () => "222222",
    registrationEmailSender: createFakeSender(sent),
    geoResolver,
  });

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login/email-code",
    headers: {},
    body: {
      appId: "app_a",
      email: "geo-fallback@example.com",
    },
    ipAddress: "198.51.100.33",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(geoCalls, 1);
  assert.equal(sent[0]?.locale, "en-US");
  assert.equal(sent[0]?.region, "ap-hongkong");
});
