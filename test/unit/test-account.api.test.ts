import assert from "node:assert/strict";
import test from "node:test";

import { KVManager, InMemoryKVBackend } from "../../src/infrastructure/kv/kv-manager.ts";
import { createApplication } from "../support/create-test-application.ts";

interface SentVerificationSms {
  phoneNumber: string;
  code: string;
  expireMinutes: number;
}

async function loginAdmin(
  runtime: Awaited<ReturnType<typeof createApplication>>,
  username = "admin",
  password = "AdminPass123!",
) {
  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/auth/login",
    headers: {},
    body: { username, password },
  });

  assert.equal(response.statusCode, 200);
  const cookie = response.headers?.["Set-Cookie"];
  assert.ok(cookie);
  return cookie;
}

async function grantReveal(
  runtime: Awaited<ReturnType<typeof createApplication>>,
  cookie: string,
) {
  const requestCodeResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/sensitive-operations/request-code",
    headers: { cookie },
    body: {
      operation: "test_account.code.reveal",
    },
  });
  assert.equal(requestCodeResponse.statusCode, 200);

  const verifyResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/sensitive-operations/verify",
    headers: { cookie },
    body: {
      operation: "test_account.code.reveal",
      code: "199510",
    },
  });
  assert.equal(verifyResponse.statusCode, 200);
}

function createFakeSmsSender(sent: SentVerificationSms[] = []) {
  return {
    async sendVerificationCode(command: SentVerificationSms) {
      sent.push(command);
      return {
        provider: "tencent_sms" as const,
        requestId: `req_${sent.length}`,
        sendSerialNo: `serial_${sent.length}`,
        phoneNumber: command.phoneNumber,
      };
    },
  };
}

test("admin test account create, reveal, reset, and duplicate checks work", async () => {
  const generatedCodes = ["246810", "135791"];
  const runtime = await createApplication({
    adminBasicAuth: { username: "admin", password: "AdminPass123!" },
    adminSensitiveOperation: { secondaryPassword: "199510" },
    registrationCodeGenerator: () => generatedCodes.shift() ?? "999999",
  });
  const cookie = await loginAdmin(runtime);

  const createResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/common/test-accounts",
    headers: { cookie },
    body: {
      appId: "ai_novel",
      phoneNa: "+86",
      phone: "18710100991",
      label: "App Review",
      enabled: true,
    },
  });

  assert.equal(createResponse.statusCode, 200);
  const item = createResponse.body.data.items[0];
  assert.equal(item.appId, "ai_novel");
  assert.equal(item.phone, "+8618710100991");
  assert.equal("verifyCode" in item, false);

  const duplicateResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/common/test-accounts",
    headers: { cookie },
    body: {
      appId: "ai_novel",
      phoneNa: "+86",
      phone: "18710100991",
      label: "Duplicate",
      enabled: true,
    },
  });
  assert.equal(duplicateResponse.statusCode, 409);

  const directRevealResponse = await runtime.app.handle({
    method: "POST",
    path: `/api/v1/admin/apps/common/test-accounts/${item.id}/reveal-code`,
    headers: { cookie },
  });
  assert.equal(directRevealResponse.statusCode, 403);
  assert.equal(directRevealResponse.body.code, "ADMIN_SENSITIVE_OPERATION_REQUIRED");

  await grantReveal(runtime, cookie);
  const revealResponse = await runtime.app.handle({
    method: "POST",
    path: `/api/v1/admin/apps/common/test-accounts/${item.id}/reveal-code`,
    headers: { cookie },
  });
  assert.equal(revealResponse.statusCode, 200);
  const initialCode = revealResponse.body.data.verifyCode;
  assert.equal(initialCode, "246810");

  const resetResponse = await runtime.app.handle({
    method: "POST",
    path: `/api/v1/admin/apps/common/test-accounts/${item.id}/reset-code`,
    headers: { cookie },
  });
  assert.equal(resetResponse.statusCode, 200);

  await grantReveal(runtime, cookie);
  const revealAfterResetResponse = await runtime.app.handle({
    method: "POST",
    path: `/api/v1/admin/apps/common/test-accounts/${item.id}/reveal-code`,
    headers: { cookie },
  });
  assert.equal(revealAfterResetResponse.statusCode, 200);
  const resetCode = revealAfterResetResponse.body.data.verifyCode;
  assert.equal(resetCode, "135791");
  assert.notEqual(resetCode, initialCode);

  const oldCodeLoginResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login/sms",
    headers: {},
    body: {
      appId: "ai_novel",
      phoneNa: "+86",
      phone: "18710100991",
      smsCode: initialCode,
      clientType: "app",
    },
    ipAddress: "198.51.100.91",
  });
  assert.equal(oldCodeLoginResponse.statusCode, 401);

  const resetCodeLoginResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login/sms",
    headers: {},
    body: {
      appId: "ai_novel",
      phoneNa: "+86",
      phone: "18710100991",
      smsCode: resetCode,
      clientType: "app",
    },
    ipAddress: "198.51.100.91",
  });
  assert.equal(resetCodeLoginResponse.statusCode, 200);
});

test("admin test account update, list, and delete work", async () => {
  const runtime = await createApplication({
    adminBasicAuth: { username: "admin", password: "AdminPass123!" },
    registrationCodeGenerator: () => "101010",
  });
  const cookie = await loginAdmin(runtime);

  const createResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/common/test-accounts",
    headers: { cookie },
    body: {
      appId: "ai_novel",
      phoneNa: "+86",
      phone: "18710100995",
      label: "Before",
      enabled: true,
    },
  });
  assert.equal(createResponse.statusCode, 200);
  const accountId = createResponse.body.data.items[0].id;

  const updateResponse = await runtime.app.handle({
    method: "PUT",
    path: `/api/v1/admin/apps/common/test-accounts/${accountId}`,
    headers: { cookie },
    body: {
      appId: "ai_novel",
      phoneNa: "+86",
      phone: "18710100995",
      label: "After",
      enabled: false,
    },
  });
  assert.equal(updateResponse.statusCode, 200);
  assert.equal(updateResponse.body.data.items[0].label, "After");
  assert.equal(updateResponse.body.data.items[0].enabled, false);

  const listResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/common/test-accounts",
    headers: { cookie },
  });
  assert.equal(listResponse.statusCode, 200);
  assert.equal(listResponse.body.data.items.length, 1);

  const deleteResponse = await runtime.app.handle({
    method: "DELETE",
    path: `/api/v1/admin/apps/common/test-accounts/${accountId}`,
    headers: { cookie },
  });
  assert.equal(deleteResponse.statusCode, 200);
  assert.deepEqual(deleteResponse.body.data.items, []);
});

test("admin test account rejects unknown app ids", async () => {
  const runtime = await createApplication({
    adminBasicAuth: { username: "admin", password: "AdminPass123!" },
  });
  const cookie = await loginAdmin(runtime);

  const createResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/common/test-accounts",
    headers: { cookie },
    body: {
      appId: "missing_app",
      phoneNa: "+86",
      phone: "18710100996",
      label: "Invalid",
      enabled: true,
    },
  });

  assert.equal(createResponse.statusCode, 404);
  assert.equal(createResponse.body.code, "APP_NOT_FOUND");
});

test("enabled test account skips sms provider and logs in with static code", async () => {
  const sent: SentVerificationSms[] = [];
  const runtime = await createApplication({
    adminBasicAuth: { username: "admin", password: "AdminPass123!" },
    adminSensitiveOperation: { secondaryPassword: "199510" },
    registrationCodeGenerator: () => "135790",
    smsVerificationSender: createFakeSmsSender(sent),
  });
  const cookie = await loginAdmin(runtime);

  await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/common/test-accounts",
    headers: { cookie },
    body: {
      appId: "ai_novel",
      phoneNa: "+86",
      phone: "18710100992",
      label: "App Review",
      enabled: true,
    },
  });

  const sendCodeResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login/sms-code",
    headers: {},
    body: {
      appId: "ai_novel",
      phoneNa: "+86",
      phone: "18710100992",
    },
    ipAddress: "198.51.100.92",
  });

  assert.equal(sendCodeResponse.statusCode, 200);
  assert.equal(sent.length, 0);

  const wrongCodeResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login/sms",
    headers: {},
    body: {
      appId: "ai_novel",
      phoneNa: "+86",
      phone: "18710100992",
      smsCode: "000000",
      clientType: "app",
    },
    ipAddress: "198.51.100.92",
  });
  assert.equal(wrongCodeResponse.statusCode, 401);

  const loginResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login/sms",
    headers: {},
    body: {
      appId: "ai_novel",
      phoneNa: "+86",
      phone: "18710100992",
      smsCode: "135790",
      clientType: "app",
    },
    ipAddress: "198.51.100.92",
  });

  assert.equal(loginResponse.statusCode, 200);
  assert.equal(loginResponse.body.data.user.hasPassword, false);
  const createdUser = runtime.database.findUserByPhone("+8618710100992");
  assert.ok(createdUser);
  assert.equal(createdUser.passwordAlgo, "sms-code-only");
  assert.ok(runtime.database.findAppUser("ai_novel", createdUser.id));
});

test("enabled test account static code locks after repeated failures", async () => {
  const runtime = await createApplication({
    adminBasicAuth: { username: "admin", password: "AdminPass123!" },
    registrationCodeGenerator: () => "121212",
  });
  const cookie = await loginAdmin(runtime);

  const createResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/common/test-accounts",
    headers: { cookie },
    body: {
      appId: "ai_novel",
      phoneNa: "+86",
      phone: "18710100997",
      label: "Brute Force",
      enabled: true,
    },
  });
  assert.equal(createResponse.statusCode, 200);
  const phone = createResponse.body.data.items[0].phone;

  for (let index = 0; index < 10; index += 1) {
    await assert.rejects(
      async () => await runtime.services.commonTestAccountService.verifyEnabledCode({
        appId: "ai_novel",
        phone,
        code: "000000",
      }),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "AUTH_VERIFICATION_CODE_INVALID",
    );
  }

  await assert.rejects(
    async () => await runtime.services.commonTestAccountService.verifyEnabledCode({
      appId: "ai_novel",
      phone,
      code: "121212",
    }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_LOGIN_TEMPORARILY_LOCKED",
  );
});

test("disabled test account falls back to normal sms provider", async () => {
  const sent: SentVerificationSms[] = [];
  const runtime = await createApplication({
    adminBasicAuth: { username: "admin", password: "AdminPass123!" },
    registrationCodeGenerator: () => "864200",
    smsVerificationSender: createFakeSmsSender(sent),
  });
  const cookie = await loginAdmin(runtime);

  const createResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/common/test-accounts",
    headers: { cookie },
    body: {
      appId: "ai_novel",
      phoneNa: "+86",
      phone: "18710100993",
      label: "Disabled Review",
      enabled: false,
    },
  });
  assert.equal(createResponse.statusCode, 200);

  const sendCodeResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login/sms-code",
    headers: {},
    body: {
      appId: "ai_novel",
      phoneNa: "+86",
      phone: "18710100993",
    },
    ipAddress: "198.51.100.93",
  });

  assert.equal(sendCodeResponse.statusCode, 200);
  assert.equal(sent.length, 1);
});

test("test account code survives a fresh application runtime with shared storage", async () => {
  const kvManager = await KVManager.create({ backend: new InMemoryKVBackend() });
  const firstRuntime = await createApplication({
    kvManager,
    adminBasicAuth: { username: "admin", password: "AdminPass123!" },
    adminSensitiveOperation: { secondaryPassword: "199510" },
    registrationCodeGenerator: () => "112233",
  });
  const firstCookie = await loginAdmin(firstRuntime);

  const createResponse = await firstRuntime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/common/test-accounts",
    headers: { cookie: firstCookie },
    body: {
      appId: "ai_novel",
      phoneNa: "+86",
      phone: "18710100994",
      label: "Persistent Review",
      enabled: true,
    },
  });
  assert.equal(createResponse.statusCode, 200);
  const accountId = createResponse.body.data.items[0].id;

  const secondRuntime = await createApplication({
    kvManager,
    adminBasicAuth: { username: "admin", password: "AdminPass123!" },
    adminSensitiveOperation: { secondaryPassword: "199510" },
    registrationCodeGenerator: () => "445566",
  });
  const secondCookie = await loginAdmin(secondRuntime);

  await grantReveal(secondRuntime, secondCookie);
  const revealResponse = await secondRuntime.app.handle({
    method: "POST",
    path: `/api/v1/admin/apps/common/test-accounts/${accountId}/reveal-code`,
    headers: { cookie: secondCookie },
  });

  assert.equal(revealResponse.statusCode, 200);
  assert.equal(revealResponse.body.data.verifyCode, "112233");
});
