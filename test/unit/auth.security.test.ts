import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { DevelopmentPasswordHasher } from "../../src/modules/auth/password-hasher.ts";
import type { RegistrationEmailSender } from "../../src/services/tencent-ses-registration-email.service.ts";
import { encodeBase64Url, signValue } from "../../src/shared/utils.ts";

function createFakeSender(): RegistrationEmailSender {
  return {
    async sendTemplateEmail() {
      return {
        provider: "tencent_ses",
      };
    },
    async sendVerificationCode() {
      return {
        provider: "tencent_ses",
      };
    },
  };
}

test("verification attempt rate limits persist across regenerated email codes", async () => {
  const generatedCodes = ["111111", "222222", "333333"];
  let codeIndex = 0;
  const runtime = await createApplication({
    registrationCodeGenerator: () => generatedCodes[Math.min(codeIndex, generatedCodes.length - 1)] as string,
    registrationEmailSender: createFakeSender(),
  });
  const email = "security-window@example.com";
  const ipAddress = "203.0.113.90";
  const baseTime = new Date("2026-03-30T10:00:00+08:00");

  for (let generation = 0; generation < 3; generation += 1) {
    codeIndex = generation;
    const issueTime = new Date(baseTime.getTime() + generation * 61 * 1000);
    await runtime.services.authService.registerEmailCode(
      {
        appId: "app_a",
        email,
        ipAddress,
        locale: "zh-CN",
        region: "ap-guangzhou",
      },
      issueTime,
    );

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const attemptTime = new Date(issueTime.getTime() + (attempt + 1) * 1000);
      const expectedCode = generation === 2 && attempt === 1 ? "AUTH_RATE_LIMITED" : "AUTH_VERIFICATION_CODE_INVALID";

      await assert.rejects(
        () =>
          runtime.services.authService.register(
            {
              appId: "app_a",
              email,
              password: "Password1234",
              emailCode: "000000",
              ipAddress,
            },
            attemptTime,
          ),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === expectedCode,
      );
    }
  }
});

test("signed but malformed access token payloads return AUTH_INVALID_TOKEN", async () => {
  const secret = "unit-test-access-token-secret";
  const runtime = await createApplication({
    accessTokenSecret: secret,
  });
  const serializedPayload = encodeBase64Url("{not-valid-json");
  const signature = signValue(secret, serializedPayload);

  const response = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/users/me",
    headers: {
      authorization: `Bearer ${serializedPayload}.${signature}`,
      "x-app-id": "app_a",
    },
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.code, "AUTH_INVALID_TOKEN");
});

test("password strength rejects passwords longer than 256 characters", () => {
  const hasher = new DevelopmentPasswordHasher();
  const tooLongPassword = `${"A".repeat(256)}1`;

  assert.equal(hasher.validateStrength("Password1234"), true);
  assert.equal(hasher.validateStrength(tooLongPassword), false);
});
