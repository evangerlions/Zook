import assert from "node:assert/strict";
import test from "node:test";
import { TencentSmsVerificationSender } from "../../src/services/tencent-sms-verification.service.ts";

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

test("tencent sms verification sender signs and sends a verification sms request", async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  const sender = new TencentSmsVerificationSender(
    {
      secretId: "sms-secret-id",
      secretKey: "sms-secret-key",
      sdkAppId: "1400849632",
      templateId: "1907577",
      signName: "智卓凯科技",
      region: "ap-beijing",
    },
    async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return createJsonResponse({
        Response: {
          RequestId: "req_sms_123",
          SendStatusSet: [
            {
              SerialNo: "serial_abc",
              PhoneNumber: "+8613812345678",
              Code: "Ok",
              Message: "send success",
            },
          ],
        },
      });
    },
  );

  const result = await sender.sendVerificationCode({
    phoneNumber: "+8613812345678",
    code: "852133",
    expireMinutes: 10,
  });

  assert.equal(capturedUrl, "https://sms.tencentcloudapi.com/");
  assert.equal(capturedInit?.method, "POST");
  const headers = capturedInit?.headers as Record<string, string>;
  assert.equal(headers["X-TC-Action"], "SendSms");
  assert.equal(headers["X-TC-Region"], "ap-beijing");
  assert.match(headers.Authorization, /^TC3-HMAC-SHA256 Credential=sms-secret-id\//);

  const parsedBody = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
  assert.deepEqual(parsedBody, {
    PhoneNumberSet: ["+8613812345678"],
    SmsSdkAppId: "1400849632",
    TemplateId: "1907577",
    SignName: "智卓凯科技",
    TemplateParamSet: ["852133", "10"],
  });

  assert.equal(result.provider, "tencent_sms");
  assert.equal(result.requestId, "req_sms_123");
  assert.equal(result.sendSerialNo, "serial_abc");
  assert.equal(result.phoneNumber, "+8613812345678");
});

test("tencent sms verification sender reports the exact missing config field", async () => {
  const cases = [
    {
      config: {
        secretKey: "sms-secret-key",
        sdkAppId: "1400849632",
        templateId: "1907577",
        signName: "智卓凯科技",
      },
      code: "SMS_SERVICE_MISSING_SECRET_ID",
      field: "TENCENT_SMS_SECRET_ID",
    },
    {
      config: {
        secretId: "sms-secret-id",
        sdkAppId: "1400849632",
        templateId: "1907577",
        signName: "智卓凯科技",
      },
      code: "SMS_SERVICE_MISSING_SECRET_KEY",
      field: "TENCENT_SMS_SECRET_KEY",
    },
    {
      config: {
        secretId: "sms-secret-id",
        secretKey: "sms-secret-key",
        templateId: "1907577",
        signName: "智卓凯科技",
      },
      code: "SMS_SERVICE_MISSING_SDK_APP_ID",
      field: "TENCENT_SMS_SDK_APP_ID",
    },
    {
      config: {
        secretId: "sms-secret-id",
        secretKey: "sms-secret-key",
        sdkAppId: "1400849632",
        signName: "智卓凯科技",
      },
      code: "SMS_SERVICE_MISSING_TEMPLATE_ID",
      field: "TENCENT_SMS_TEMPLATE_ID",
    },
    {
      config: {
        secretId: "sms-secret-id",
        secretKey: "sms-secret-key",
        sdkAppId: "1400849632",
        templateId: "1907577",
      },
      code: "SMS_SERVICE_MISSING_SIGN_NAME",
      field: "TENCENT_SMS_SIGN_NAME",
    },
  ];

  for (const item of cases) {
    const sender = new TencentSmsVerificationSender(item.config);

    await assert.rejects(
      () =>
        sender.sendVerificationCode({
          phoneNumber: "+8613812345678",
          code: "852133",
          expireMinutes: 10,
        }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === item.code &&
        "details" in error &&
        (error.details as { missingField?: string }).missingField === item.field,
    );
  }
});
