import assert from "node:assert/strict";
import test from "node:test";
import { TencentCaptchaVerificationService } from "../../src/services/tencent-captcha-verification.service.ts";

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

test("tencent captcha verification service signs and verifies captcha tickets", async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  const service = new TencentCaptchaVerificationService(
    {
      secretId: "captcha-secret-id",
      secretKey: "captcha-secret-key",
      captchaAppId: 197005223,
      appSecretKey: "captcha-app-secret",
    },
    async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return createJsonResponse({
        Response: {
          RequestId: "req_captcha_123",
          CaptchaCode: 1,
          CaptchaMsg: "ok",
        },
      });
    },
  );

  const result = await service.verifyCaptcha({
    ticket: "ticket_123",
    userIp: "127.0.0.1",
    randstr: "rand_123",
  });

  assert.equal(capturedUrl, "https://captcha.tencentcloudapi.com/");
  assert.equal(capturedInit?.method, "POST");
  const headers = capturedInit?.headers as Record<string, string>;
  assert.equal(headers["X-TC-Action"], "DescribeCaptchaResult");
  assert.match(headers.Authorization, /^TC3-HMAC-SHA256 Credential=captcha-secret-id\//);

  const parsedBody = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
  assert.deepEqual(parsedBody, {
    CaptchaType: 9,
    Ticket: "ticket_123",
    UserIp: "127.0.0.1",
    Randstr: "rand_123",
    CaptchaAppId: 197005223,
    AppSecretKey: "captcha-app-secret",
  });

  assert.equal(result.provider, "tencent_captcha");
  assert.equal(result.success, true);
  assert.equal(result.requestId, "req_captcha_123");
  assert.equal(result.captchaCode, 1);
  assert.equal(result.message, null);
});

test("tencent captcha verification service reports non-success captcha responses without throwing", async () => {
  const service = new TencentCaptchaVerificationService(
    {
      secretId: "captcha-secret-id",
      secretKey: "captcha-secret-key",
      captchaAppId: 197005223,
      appSecretKey: "captcha-app-secret",
    },
    async () =>
      createJsonResponse({
        Response: {
          RequestId: "req_captcha_456",
          CaptchaCode: 7,
          CaptchaMsg: "ticket invalid",
        },
      }),
  );

  const result = await service.verifyCaptcha({
    ticket: "ticket_456",
    userIp: "127.0.0.1",
    randstr: "rand_456",
  });

  assert.equal(result.success, false);
  assert.equal(result.message, "ticket invalid");
  assert.equal(result.captchaCode, 7);
});

test("tencent captcha verification service fails clearly when required config is missing", async () => {
  const service = new TencentCaptchaVerificationService({
    secretId: "captcha-secret-id",
    secretKey: "captcha-secret-key",
  });

  await assert.rejects(
    () =>
      service.verifyCaptcha({
        ticket: "ticket_789",
        userIp: "127.0.0.1",
        randstr: "rand_789",
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "CAPTCHA_SERVICE_NOT_CONFIGURED",
  );
});
