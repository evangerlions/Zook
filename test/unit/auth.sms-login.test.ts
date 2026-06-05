import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";
import { ApplicationError } from "../../src/shared/errors.ts";
import type { SmsVerificationSender } from "../../src/services/tencent-sms-verification.service.ts";

interface SentVerificationSms {
  phoneNumber: string;
  code: string;
  expireMinutes: number;
}

function createFakeSmsSender(sent: SentVerificationSms[]): SmsVerificationSender {
  return {
    async sendVerificationCode(command) {
      sent.push(command);
      return {
        provider: "tencent_sms",
        phoneNumber: command.phoneNumber,
      };
    },
  };
}

test("sms-code login sends sms, auto-creates account, and blocks password login for sms-code-only users", async () => {
  const sent: SentVerificationSms[] = [];
  const runtime = await createApplication({
    registrationCodeGenerator: () => "123456",
    smsVerificationSender: createFakeSmsSender(sent),
  });

  const sendCodeResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login/sms-code",
    headers: {},
    body: {
      appId: "app_a",
      phone: "18710100985",
      phoneNa: "+86",
    },
    ipAddress: "198.51.100.70",
  });

  assert.equal(sendCodeResponse.statusCode, 200);
  assert.deepEqual(sendCodeResponse.body.data, {
    accepted: true,
    cooldownSeconds: 60,
    expiresInSeconds: 600,
  });
  assert.deepEqual(sent, [
    {
      phoneNumber: "+8618710100985",
      code: "123456",
      expireMinutes: 10,
    },
  ]);

  const loginResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login/sms",
    headers: {},
    body: {
      appId: "app_a",
      phone: "18710100985",
      phoneNa: "+86",
      smsCode: "123456",
      clientType: "app",
    },
    ipAddress: "198.51.100.70",
  });

  assert.equal(loginResponse.statusCode, 200);
  assert.ok(typeof loginResponse.body.data.accessToken === "string");
  assert.ok(typeof loginResponse.body.data.refreshToken === "string");

  const createdUser = runtime.database.findUserByPhone("+8618710100985");
  assert.ok(createdUser);
  assert.equal(createdUser.passwordAlgo, "sms-code-only");
  assert.equal(loginResponse.body.data.user.id, createdUser.id);
  assert.equal(loginResponse.body.data.user.phone, "+8618710100985");
  assert.equal(loginResponse.body.data.user.hasPassword, false);
  assert.ok(
    runtime.database.auditLogs.some((item) => item.action === "auth.login.sms_code" && item.appId === "app_a"),
  );
  assert.ok(
    runtime.database.auditLogs.some((item) => item.action === "auth.login.sms" && item.resourceOwnerUserId === createdUser.id),
  );

  const passwordLoginResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login",
    headers: {},
    body: {
      appId: "app_a",
      account: "+8618710100985",
      password: "Password1234",
      clientType: "app",
    },
    ipAddress: "198.51.100.70",
  });

  assert.equal(passwordLoginResponse.statusCode, 401);
  assert.equal(passwordLoginResponse.body.code, "AUTH_PASSWORD_NOT_SET");
  assert.equal(
    passwordLoginResponse.body.message,
    "No password is set. Please sign in with a verification code.",
  );
});

test("sms login rejects first-login into INVITE_ONLY apps", async () => {
  const runtime = await createApplication({
    registrationCodeGenerator: () => "654321",
    smsVerificationSender: createFakeSmsSender([]),
  });

  await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login/sms-code",
    headers: {},
    body: {
      appId: "app_b",
      phone: "18710100986",
      phoneNa: "+86",
    },
    ipAddress: "198.51.100.71",
  });

  const loginResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login/sms",
    headers: {},
    body: {
      appId: "app_b",
      phone: "18710100986",
      phoneNa: "+86",
      smsCode: "654321",
      clientType: "app",
    },
    ipAddress: "198.51.100.71",
  });

  assert.equal(loginResponse.statusCode, 403);
  assert.equal(loginResponse.body.code, "APP_JOIN_INVITE_REQUIRED");
});

test("sms registration creates a new account and rejects existing phone conflicts", async () => {
  const sent: SentVerificationSms[] = [];
  const runtime = await createApplication({
    registrationCodeGenerator: () => "111111",
    smsVerificationSender: createFakeSmsSender(sent),
  });

  const sendCodeResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/register/sms-code",
    headers: {},
    body: {
      appId: "app_a",
      phone: "18710100987",
      phoneNa: "+86",
    },
    ipAddress: "198.51.100.72",
  });

  assert.equal(sendCodeResponse.statusCode, 200);

  const registerResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/register/sms",
    headers: {},
    body: {
      appId: "app_a",
      phone: "18710100987",
      phoneNa: "+86",
      smsCode: "111111",
      clientType: "app",
    },
    ipAddress: "198.51.100.72",
  });

  assert.equal(registerResponse.statusCode, 200);
  assert.equal(registerResponse.body.data.user.phone, "+8618710100987");
  assert.equal(registerResponse.body.data.user.hasPassword, false);

  const duplicateSendCodeResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/register/sms-code",
    headers: {},
    body: {
      appId: "app_a",
      phone: "18710100987",
      phoneNa: "+86",
    },
    ipAddress: "198.51.100.73",
  });

  assert.equal(duplicateSendCodeResponse.statusCode, 200);

  const duplicateRegisterResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/register/sms",
    headers: {},
    body: {
      appId: "app_a",
      phone: "18710100987",
      phoneNa: "+86",
      smsCode: "111111",
      clientType: "app",
    },
    ipAddress: "198.51.100.73",
  });

  assert.equal(duplicateRegisterResponse.statusCode, 409);
  assert.equal(duplicateRegisterResponse.body.code, "AUTH_ACCOUNT_ALREADY_EXISTS");
});

test("sms password code hides account existence and sms password reset upgrades sms-code-only accounts", async () => {
  const sent: SentVerificationSms[] = [];
  let nextCode = "222222";
  const runtime = await createApplication({
    registrationCodeGenerator: () => nextCode,
    smsVerificationSender: createFakeSmsSender(sent),
  });

  await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login/sms-code",
    headers: {},
    body: {
      appId: "app_a",
      phone: "18710100988",
      phoneNa: "+86",
    },
    ipAddress: "198.51.100.74",
  });

  const smsLoginResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login/sms",
    headers: {},
    body: {
      appId: "app_a",
      phone: "18710100988",
      phoneNa: "+86",
      smsCode: "222222",
      clientType: "app",
    },
    ipAddress: "198.51.100.74",
  });

  assert.equal(smsLoginResponse.statusCode, 200);
  assert.equal(runtime.database.findUserByPhone("+8618710100988")?.passwordAlgo, "sms-code-only");

  const hiddenResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/password/sms-code",
    headers: {},
    body: {
      appId: "app_a",
      phone: "18710100999",
      phoneNa: "+86",
    },
    ipAddress: "198.51.100.75",
  });

  assert.equal(hiddenResponse.statusCode, 200);
  assert.deepEqual(hiddenResponse.body.data, {
    accepted: true,
    cooldownSeconds: 60,
    expiresInSeconds: 600,
  });

  nextCode = "333333";
  const sendPasswordCodeResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/password/sms-code",
    headers: {},
    body: {
      appId: "app_a",
      phone: "18710100988",
      phoneNa: "+86",
    },
    ipAddress: "198.51.100.74",
  });

  assert.equal(sendPasswordCodeResponse.statusCode, 200);

  const resetResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/password/reset-by-sms",
    headers: {},
    body: {
      appId: "app_a",
      phone: "18710100988",
      phoneNa: "+86",
      smsCode: "333333",
      password: "Password5678",
      clientType: "app",
    },
    ipAddress: "198.51.100.74",
  });

  assert.equal(resetResponse.statusCode, 200);
  assert.equal(runtime.database.findUserByPhone("+8618710100988")?.passwordAlgo, "scrypt");

  const passwordLoginResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login",
    headers: {},
    body: {
      appId: "app_a",
      account: "+8618710100988",
      password: "Password5678",
      clientType: "app",
    },
    ipAddress: "198.51.100.74",
  });

  assert.equal(passwordLoginResponse.statusCode, 200);
});

test("sms password-code resend cooldown is enforced before blocked-account hiding", async () => {
  const sent: SentVerificationSms[] = [];
  let nextCode = "626262";
  const runtime = await createApplication({
    registrationCodeGenerator: () => nextCode,
    smsVerificationSender: createFakeSmsSender(sent),
  });
  const now = new Date("2026-03-30T10:00:00+08:00");

  await runtime.services.authService.loginSmsCode(
    {
      appId: "app_a",
      phone: "18710100992",
      phoneNa: "+86",
      ipAddress: "198.51.100.80",
    },
    now,
  );
  const login = await runtime.services.authService.loginWithSmsCode(
    {
      appId: "app_a",
      phone: "18710100992",
      phoneNa: "+86",
      smsCode: "626262",
      ipAddress: "198.51.100.80",
    },
    new Date(now.getTime() + 10 * 1000),
  );
  assert.ok(login.session.accessToken);

  nextCode = "727272";
  const firstResponse = await runtime.services.authService.sendPasswordSmsCode(
    {
      appId: "app_a",
      phone: "18710100992",
      phoneNa: "+86",
      ipAddress: "198.51.100.80",
    },
    new Date(now.getTime() + 20 * 1000),
  );
  assert.equal(firstResponse.accepted, true);

  const user = runtime.database.findUserByPhone("+8618710100992");
  assert.ok(user);
  user.status = "BLOCKED";

  await assert.rejects(
    () =>
      runtime.services.authService.sendPasswordSmsCode(
        {
          appId: "app_a",
          phone: "18710100992",
          phoneNa: "+86",
          ipAddress: "198.51.100.80",
        },
        new Date(now.getTime() + 50 * 1000),
      ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_RATE_LIMITED" &&
      "statusCode" in error &&
      error.statusCode === 429,
  );
  assert.deepEqual(sent.map((item) => item.code), ["626262", "727272"]);
});

test("sms code endpoints accept test=true and skip real sms sending while still issuing usable codes", async () => {
  const sent: SentVerificationSms[] = [];
  const runtime = await createApplication({
    registrationCodeGenerator: () => "444444",
    smsVerificationSender: createFakeSmsSender(sent),
  });

  const loginCodeResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login/sms-code",
    headers: {},
    body: {
      appId: "app_a",
      phone: "18710100989",
      phoneNa: "+86",
      test: true,
    },
    ipAddress: "198.51.100.76",
  });

  assert.equal(loginCodeResponse.statusCode, 200);
  assert.equal(sent.length, 0);

  const loginResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login/sms",
    headers: {},
    body: {
      appId: "app_a",
      phone: "18710100989",
      phoneNa: "+86",
      smsCode: "444444",
      clientType: "app",
    },
    ipAddress: "198.51.100.76",
  });

  assert.equal(loginResponse.statusCode, 200);

  const registerCodeResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/register/sms-code",
    headers: {},
    body: {
      appId: "app_a",
      phone: "18710100990",
      phoneNa: "+86",
      test: true,
    },
    ipAddress: "198.51.100.77",
  });

  assert.equal(registerCodeResponse.statusCode, 200);
  assert.equal(sent.length, 0);

  const registerResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/register/sms",
    headers: {},
    body: {
      appId: "app_a",
      phone: "18710100990",
      phoneNa: "+86",
      smsCode: "444444",
      clientType: "app",
    },
    ipAddress: "198.51.100.77",
  });

  assert.equal(registerResponse.statusCode, 200);

  const passwordCodeResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/password/sms-code",
    headers: {},
    body: {
      appId: "app_a",
      phone: "18710100989",
      phoneNa: "+86",
      test: true,
    },
    ipAddress: "198.51.100.76",
  });

  assert.equal(passwordCodeResponse.statusCode, 200);
  assert.equal(sent.length, 0);

  const resetResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/password/reset-by-sms",
    headers: {},
    body: {
      appId: "app_a",
      phone: "18710100989",
      phoneNa: "+86",
      smsCode: "444444",
      password: "Password9876",
      clientType: "app",
    },
    ipAddress: "198.51.100.76",
  });

  assert.equal(resetResponse.statusCode, 200);
  assert.equal(sent.length, 0);
});

test("sms provider failures persist structured provider details for admin inspection", async () => {
  const runtime = await createApplication({
    registrationCodeGenerator: () => "555555",
    smsVerificationSender: {
      async sendVerificationCode() {
        throw new ApplicationError(
          502,
          "SMS_PROVIDER_REQUEST_FAILED",
          "FailedOperation.SignatureIncorrect: SMS signature is invalid.",
          {
            provider: "tencent_sms",
            requestId: "req_sms_failed",
            debug: {
              request: {
                body: {
                  PhoneNumberSet: ["+8618710100991"],
                  TemplateParamSet: ["555555", "10"],
                },
              },
              response: {
                Response: {
                  RequestId: "req_sms_failed",
                },
              },
            },
            sendStatus: {
              Code: "FailedOperation.SignatureIncorrect",
              Message: "SMS signature is invalid.",
              PhoneNumber: "+8618710100991",
              SerialNo: "serial_failed",
            },
          },
        );
      },
    },
  });

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login/sms-code",
    headers: {},
    body: {
      appId: "app_a",
      phone: "18710100991",
      phoneNa: "+86",
    },
    ipAddress: "198.51.100.78",
  });

  assert.equal(response.statusCode, 502);
  assert.equal(response.body.code, "SMS_PROVIDER_REQUEST_FAILED");
  const record = runtime.database.smsVerificationRecords.find(
    (item) => item.scene === "login" && item.status === "provider_failed",
  );
  assert.ok(record);
  assert.equal(record.status, "provider_failed");
  assert.equal(record.providerRequestId, "req_sms_failed");
  assert.ok(record.providerMessage);
  const providerMessage = JSON.parse(record.providerMessage) as {
    code: string;
    message: string;
    details: {
      provider: string;
      requestId: string;
      debug?: unknown;
      sendStatus: {
        Code: string;
        Message: string;
        PhoneNumber?: string;
        SerialNo?: string;
      };
    };
  };
  assert.equal(providerMessage.code, "SMS_PROVIDER_REQUEST_FAILED");
  assert.equal(providerMessage.details.provider, "tencent_sms");
  assert.equal(providerMessage.details.requestId, "req_sms_failed");
  assert.equal(providerMessage.details.debug, undefined);
  assert.equal(providerMessage.details.sendStatus.Code, "FailedOperation.SignatureIncorrect");
  assert.equal(providerMessage.details.sendStatus.SerialNo, "serial_failed");
  assert.equal(providerMessage.details.sendStatus.PhoneNumber, undefined);
});
