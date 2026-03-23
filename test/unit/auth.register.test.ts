import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { type RegistrationEmailSender } from "../../src/services/tencent-ses-registration-email.service.ts";

interface SentRegistrationEmail {
  appId: string;
  email: string;
  code: string;
  locale: string;
  senderId: string;
  replyToAddresses?: string;
  subject: string;
}

function createFakeSender(sent: SentRegistrationEmail[]): RegistrationEmailSender {
  return {
    async sendRegistrationCode(command) {
      sent.push(command);
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
      appId: "app_a",
      email: "carol@example.com",
      code: "123456",
      locale: "zh-CN",
      senderId: "default",
      replyToAddresses: undefined,
      subject: "验证码",
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

  const createdUser = runtime.database.findUserByAccount("carol@example.com");
  assert.ok(createdUser);
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
  const sent: Array<{ appId: string; email: string; code: string }> = [];
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
      },
      new Date(baseTime.getTime() + 55 * 60 * 1000),
    ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_RATE_LIMITED",
  );

  const ipSent: Array<{ appId: string; email: string; code: string }> = [];
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
  const sent: Array<{ appId: string; email: string; code: string }> = [];
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
    },
    baseTime,
  );

  assert.throws(
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

  const secondSent: Array<{ appId: string; email: string; code: string }> = [];
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
    },
    issueTime,
  );

  const session = secondRuntime.services.authService.register(
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

  assert.throws(
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
