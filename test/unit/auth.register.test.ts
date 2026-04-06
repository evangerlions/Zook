import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";
import { type RegistrationEmailSender } from "../../src/services/tencent-ses-registration-email.service.ts";

interface SentRegistrationEmail {
  appName: string;
  email: string;
  code: string;
  locale: string;
  region: "ap-guangzhou" | "ap-hongkong";
  expireMinutes: number;
}

function createFakeSender(sent: SentRegistrationEmail[]): RegistrationEmailSender {
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

test("register email-code and register APIs create a new account and issue tokens", async () => {
  const sent: SentRegistrationEmail[] = [];
  const runtime = await createApplication({
    registrationCodeGenerator: () => "123456",
    registrationEmailSender: createFakeSender(sent),
  });

  const sendCodeResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/register/email-code",
    headers: {},
    body: {
      appId: "app_a",
      email: "carol@example.com",
    },
    ipAddress: "203.0.113.10",
  });

  assert.equal(sendCodeResponse.statusCode, 200);
  assert.equal(sendCodeResponse.body.code, "OK");
  assert.deepEqual(sendCodeResponse.body.data, {
    accepted: true,
    cooldownSeconds: 60,
    expiresInSeconds: 600,
  });
  assert.deepEqual(sent, [
    {
      appName: "应用 A",
      email: "carol@example.com",
      code: "123456",
      locale: "zh-CN",
      region: "ap-guangzhou",
      expireMinutes: 10,
      templateName: "verify-code",
    },
  ]);

  const registerResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/register",
    headers: {},
    body: {
      appId: "app_a",
      email: "carol@example.com",
      password: "Password1234",
      emailCode: "123456",
      clientType: "app",
    },
    ipAddress: "203.0.113.10",
  });

  assert.equal(registerResponse.statusCode, 200);
  assert.equal(registerResponse.body.code, "OK");
  assert.ok(typeof registerResponse.body.data.accessToken === "string");
  assert.ok(typeof registerResponse.body.data.refreshToken === "string");
  assert.equal(registerResponse.body.data.user.name, "carol");
  assert.equal(registerResponse.body.data.user.email, "carol@example.com");
  assert.equal(registerResponse.body.data.user.avatarUrl, null);
  assert.equal(registerResponse.body.data.user.hasPassword, true);

  const createdUser = runtime.database.findUserByAccount("carol@example.com");
  assert.ok(createdUser);
  assert.equal(registerResponse.body.data.user.id, createdUser.id);
  assert.ok(runtime.database.findAppUser("app_a", createdUser.id));
  assert.ok(
    runtime.database.userRoles.some(
      (item) => item.appId === "app_a" && item.userId === createdUser.id,
    ),
  );
  assert.ok(
    runtime.database.auditLogs.some(
      (item) => item.action === "auth.register.email_code" && item.appId === "app_a",
    ),
  );
  assert.ok(
    runtime.database.auditLogs.some(
      (item) => item.action === "auth.register" && item.resourceOwnerUserId === createdUser.id,
    ),
  );
});

test("registerEmailCode enforces resend cooldown per app, email and IP", async () => {
  const sent: SentRegistrationEmail[] = [];
  const runtime = await createApplication({
    registrationCodeGenerator: () => "123456",
    registrationEmailSender: createFakeSender(sent),
  });
  const baseTime = new Date("2026-03-19T10:00:00+08:00");

  const first = await runtime.services.authService.registerEmailCode(
    {
      appId: "app_a",
      email: "cooldown@example.com",
      ipAddress: "203.0.113.11",
      locale: "zh-CN",
      region: "ap-guangzhou",
    },
    baseTime,
  );
  assert.equal(first.accepted, true);
  assert.equal(sent.length, 1);

  await assert.rejects(
    runtime.services.authService.registerEmailCode(
      {
        appId: "app_a",
        email: "cooldown@example.com",
        ipAddress: "203.0.113.11",
        locale: "zh-CN",
        region: "ap-guangzhou",
      },
      new Date(baseTime.getTime() + 30 * 1000),
    ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_RATE_LIMITED" &&
      "statusCode" in error &&
      error.statusCode === 429,
  );
});

test("registerEmailCode enforces daily email limit and hourly IP limit", async () => {
  const sent: SentRegistrationEmail[] = [];
  const runtime = await createApplication({
    registrationCodeGenerator: () => "123456",
    registrationEmailSender: createFakeSender(sent),
  });
  const baseTime = new Date("2026-03-19T08:00:00+08:00");

  for (let index = 0; index < 5; index += 1) {
    const now = new Date(baseTime.getTime() + index * 11 * 60 * 1000);
    const result = await runtime.services.authService.registerEmailCode(
      {
        appId: "app_a",
        email: "daily-limit@example.com",
        ipAddress: "203.0.113.12",
        locale: "zh-CN",
        region: "ap-guangzhou",
      },
      now,
    );
    assert.equal(result.accepted, true);
  }

  await assert.rejects(
    runtime.services.authService.registerEmailCode(
      {
        appId: "app_a",
        email: "daily-limit@example.com",
        ipAddress: "203.0.113.12",
        locale: "zh-CN",
        region: "ap-guangzhou",
      },
      new Date(baseTime.getTime() + 55 * 60 * 1000),
    ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_RATE_LIMITED",
  );

  const ipSent: SentRegistrationEmail[] = [];
  const ipRuntime = await createApplication({
    registrationCodeGenerator: () => "123456",
    registrationEmailSender: createFakeSender(ipSent),
  });
  for (let index = 0; index < 20; index += 1) {
    const now = new Date(baseTime.getTime() + index * 2 * 60 * 1000);
    const result = await ipRuntime.services.authService.registerEmailCode(
      {
        appId: "app_a",
        email: `ip-hour-${index}@example.com`,
        ipAddress: "203.0.113.13",
        locale: "zh-CN",
        region: "ap-guangzhou",
      },
      now,
    );
    assert.equal(result.accepted, true);
  }

  await assert.rejects(
    ipRuntime.services.authService.registerEmailCode(
      {
        appId: "app_a",
        email: "ip-hour-overflow@example.com",
        ipAddress: "203.0.113.13",
        locale: "zh-CN",
        region: "ap-guangzhou",
      },
      new Date(baseTime.getTime() + 40 * 60 * 1000),
    ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_RATE_LIMITED",
  );
});

test("register rejects expired or reused verification codes", async () => {
  const sent: SentRegistrationEmail[] = [];
  const runtime = await createApplication({
    registrationCodeGenerator: () => "123456",
    registrationEmailSender: createFakeSender(sent),
  });
  const baseTime = new Date("2026-03-19T12:00:00+08:00");

  await runtime.services.authService.registerEmailCode(
    {
      appId: "app_a",
      email: "expired@example.com",
      ipAddress: "203.0.113.14",
      locale: "zh-CN",
      region: "ap-guangzhou",
    },
    baseTime,
  );

  await assert.rejects(
    () =>
      runtime.services.authService.register(
        {
          appId: "app_a",
          email: "expired@example.com",
          password: "Password1234",
          emailCode: "123456",
          ipAddress: "203.0.113.14",
        },
        new Date(baseTime.getTime() + 11 * 60 * 1000),
      ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_VERIFICATION_CODE_INVALID",
  );

  const secondSent: SentRegistrationEmail[] = [];
  const secondRuntime = await createApplication({
    registrationCodeGenerator: () => "654321",
    registrationEmailSender: createFakeSender(secondSent),
  });
  const issueTime = new Date("2026-03-19T14:00:00+08:00");

  await secondRuntime.services.authService.registerEmailCode(
    {
      appId: "app_a",
      email: "single-use@example.com",
      ipAddress: "203.0.113.15",
      locale: "zh-CN",
      region: "ap-guangzhou",
    },
    issueTime,
  );

  const session = await secondRuntime.services.authService.register(
    {
      appId: "app_a",
      email: "single-use@example.com",
      password: "Password1234",
      emailCode: "654321",
      ipAddress: "203.0.113.15",
    },
    new Date(issueTime.getTime() + 10 * 1000),
  );
  assert.ok(session.accessToken);

  await assert.rejects(
    () =>
      secondRuntime.services.authService.register(
        {
          appId: "app_a",
          email: "single-use@example.com",
          password: "Password1234",
          emailCode: "654321",
          ipAddress: "203.0.113.15",
        },
        new Date(issueTime.getTime() + 20 * 1000),
      ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error.code === "AUTH_VERIFICATION_CODE_INVALID" ||
        error.code === "AUTH_ACCOUNT_ALREADY_EXISTS"),
  );
});
