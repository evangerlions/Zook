import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";
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
  assert.equal(passwordLoginResponse.body.code, "AUTH_INVALID_CREDENTIAL");
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
