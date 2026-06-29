import assert from "node:assert/strict";
import test from "node:test";
import { TENCENT_SES_CALLBACK_TOKEN_PASSWORD_KEY } from "../../src/services/tencent-ses-email-callback.service.ts";
import { createApplication } from "../support/create-test-application.ts";

const CALLBACK_TOKEN = "stable-callback-token";
const ROTATED_CALLBACK_TOKEN = "rotated-callback-token";

function createAdminAuthHeader(
  username = "admin",
  password = "AdminPass123!",
): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

async function configureCallbackToken(runtime: Awaited<ReturnType<typeof createApplication>>): Promise<void> {
  await setCallbackToken(runtime, CALLBACK_TOKEN);
}

async function setCallbackToken(
  runtime: Awaited<ReturnType<typeof createApplication>>,
  token: string,
): Promise<void> {
  await runtime.services.commonPasswordConfigService.set(
    TENCENT_SES_CALLBACK_TOKEN_PASSWORD_KEY,
    "Tencent SES callback token",
    token,
  );
}

test("tencent SES email callback requires configured static token", async () => {
  const unconfiguredRuntime = await createApplication();
  const runtime = await createApplication();
  await configureCallbackToken(runtime);
  const body = {
    event: "delivered",
    eventid: 1,
    email: "reader@example.com",
    timestamp: 1761555400,
  };

  const unconfiguredResponse = await unconfiguredRuntime.app.handle({
    method: "POST",
    path: "/api/v1/email/tencent/callback",
    headers: {},
    query: {
      token: CALLBACK_TOKEN,
    },
    body,
  });

  assert.equal(unconfiguredResponse.statusCode, 401);
  assert.equal(unconfiguredResponse.body.code, "AUTH_INVALID_TOKEN");

  const missingTokenResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/email/tencent/callback",
    headers: {},
    body,
  });

  assert.equal(missingTokenResponse.statusCode, 401);
  assert.equal(missingTokenResponse.body.code, "AUTH_INVALID_TOKEN");

  const wrongTokenResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/email/tencent/callback",
    headers: {},
    query: {
      token: "wrong-token",
    },
    body,
  });

  assert.equal(wrongTokenResponse.statusCode, 401);
  assert.equal(wrongTokenResponse.body.code, "AUTH_INVALID_TOKEN");
  assert.equal(runtime.database.emailDeliveryEvents.length, 0);

  const acceptedResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/email/tencent/callback",
    headers: {},
    query: {
      token: CALLBACK_TOKEN,
    },
    body,
  });

  assert.equal(acceptedResponse.statusCode, 200);
  assert.equal(acceptedResponse.body.data.accepted, true);
  assert.equal(runtime.database.emailDeliveryEvents.length, 1);
});

test("tencent SES email callback follows password service token updates", async () => {
  const runtime = await createApplication();
  await configureCallbackToken(runtime);
  const body = {
    event: "delivered",
    eventid: 1,
    email: "reader@example.com",
    timestamp: 1761555400,
  };

  await setCallbackToken(runtime, ROTATED_CALLBACK_TOKEN);

  const staleTokenResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/email/tencent/callback",
    headers: {},
    query: {
      token: CALLBACK_TOKEN,
    },
    body,
  });

  assert.equal(staleTokenResponse.statusCode, 401);
  assert.equal(staleTokenResponse.body.code, "AUTH_INVALID_TOKEN");
  assert.equal(runtime.database.emailDeliveryEvents.length, 0);

  const rotatedTokenResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/email/tencent/callback",
    headers: {},
    query: {
      token: ROTATED_CALLBACK_TOKEN,
    },
    body,
  });

  assert.equal(rotatedTokenResponse.statusCode, 200);
  assert.equal(rotatedTokenResponse.body.data.accepted, true);
  assert.equal(runtime.database.emailDeliveryEvents.length, 1);
});

test("tencent SES email callback stores official bounce event and exposes it in admin list", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });
  await configureCallbackToken(runtime);

  const callbackResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/email/tencent/callback",
    headers: {},
    query: {
      token: CALLBACK_TOKEN,
    },
    body: {
      event: "bounce",
      email: "Example@Example.com",
      bulkId: "qcloudses-30-251200670-date-20220601142439-8jolHvR2XcXC1",
      timestamp: 1654064683,
      eventid: 3,
      reason: "551 5.1.1 recipient is not exist",
      bounceType: "hard_bounce",
      username: "251200670",
      from: "test@fromexample.com",
      fromDomain: "fromexample.com",
      templateId: 123456,
      subject: "example subject",
      messageId: "ea2783c1-7704-48a8-af36-2b9e83e767ec@fromexample.com",
      sentTimestamp: 1761555487,
      "X-Tencentcloudses-Cb-Custom": "ses callback",
    },
  });

  assert.equal(callbackResponse.statusCode, 200);
  assert.equal(callbackResponse.body.data.accepted, true);
  assert.equal(callbackResponse.body.data.event, "bounce");
  assert.equal(runtime.database.emailDeliveryEvents.length, 1);
  assert.equal(runtime.database.emailDeliveryEvents[0]?.email, "example@example.com");
  assert.equal(runtime.database.emailDeliveryEvents[0]?.rawPayload["X-Tencentcloudses-Cb-Custom"], "ses callback");

  const adminResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/common/email-service/events",
    headers: {
      authorization: createAdminAuthHeader(),
    },
    query: {
      event: "bounce",
      email: "example",
    },
  });

  assert.equal(adminResponse.statusCode, 200);
  assert.equal(adminResponse.body.data.items.length, 1);
  assert.equal(adminResponse.body.data.items[0].event, "bounce");
  assert.equal(adminResponse.body.data.items[0].reason, "551 5.1.1 recipient is not exist");
  assert.equal(adminResponse.body.data.items[0].bounceType, "hard_bounce");
  assert.equal(adminResponse.body.data.items[0].templateId, 123456);
  assert.ok(
    runtime.database.auditLogs.some(
      (item) => item.action === "admin.email_event.read",
    ),
  );
});

test("tencent SES email callback stores click and delivered events for admin filtering", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });
  await configureCallbackToken(runtime);

  await runtime.app.handle({
    method: "POST",
    path: "/api/v1/email/tencent/callback",
    headers: {},
    query: {
      token: CALLBACK_TOKEN,
    },
    body: {
      event: "delivered",
      email: "reader@example.com",
      timestamp: 1761555400,
      eventid: 1,
      subject: "Welcome",
      messageId: "message-1@example.com",
    },
  });
  await runtime.app.handle({
    method: "POST",
    path: "/api/v1/email/tencent/callback",
    headers: {},
    query: {
      token: CALLBACK_TOKEN,
    },
    body: {
      event: "click",
      email: "reader@example.com",
      timestamp: 1761555500,
      eventid: 5,
      link: "https://example.com/story",
      useragent: "Mozilla/5.0",
      messageId: "message-1@example.com",
    },
  });

  const adminResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/common/email-service/events",
    headers: {
      authorization: createAdminAuthHeader(),
    },
    query: {
      event: "click",
      limit: "1",
    },
  });

  assert.equal(adminResponse.statusCode, 200);
  assert.equal(adminResponse.body.data.items.length, 1);
  assert.equal(adminResponse.body.data.items[0].event, "click");
  assert.equal(adminResponse.body.data.items[0].link, "https://example.com/story");
  assert.equal(adminResponse.body.data.items[0].userAgent, "Mozilla/5.0");
});

test("tencent SES email callback rejects unknown or incomplete payloads without storing", async () => {
  const runtime = await createApplication();
  await configureCallbackToken(runtime);

  const unknownResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/email/tencent/callback",
    headers: {},
    query: {
      token: CALLBACK_TOKEN,
    },
    body: {
      event: "unknown",
      email: "reader@example.com",
    },
  });

  assert.equal(unknownResponse.statusCode, 400);
  assert.equal(unknownResponse.body.code, "REQ_INVALID_BODY");

  const missingEmailResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/email/tencent/callback",
    headers: {},
    query: {
      token: CALLBACK_TOKEN,
    },
    body: {
      event: "delivered",
    },
  });

  assert.equal(missingEmailResponse.statusCode, 400);
  assert.equal(missingEmailResponse.body.code, "REQ_INVALID_BODY");

  const missingTimestampResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/email/tencent/callback",
    headers: {},
    query: {
      token: CALLBACK_TOKEN,
    },
    body: {
      event: "delivered",
      email: "reader@example.com",
    },
  });

  assert.equal(missingTimestampResponse.statusCode, 400);
  assert.equal(missingTimestampResponse.body.code, "REQ_INVALID_BODY");

  const blankTimestampResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/email/tencent/callback",
    headers: {},
    query: {
      token: CALLBACK_TOKEN,
    },
    body: {
      event: "delivered",
      eventid: 1,
      email: "reader@example.com",
      timestamp: "   ",
    },
  });

  assert.equal(blankTimestampResponse.statusCode, 400);
  assert.equal(blankTimestampResponse.body.code, "REQ_INVALID_BODY");

  const stringTimestampResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/email/tencent/callback",
    headers: {},
    query: {
      token: CALLBACK_TOKEN,
    },
    body: {
      event: "delivered",
      eventid: 1,
      email: "reader@example.com",
      timestamp: "1761555500",
    },
  });

  assert.equal(stringTimestampResponse.statusCode, 400);
  assert.equal(stringTimestampResponse.body.code, "REQ_INVALID_BODY");
  assert.equal(runtime.database.emailDeliveryEvents.length, 0);
});

test("tencent SES email callback rejects eventid mismatches without storing", async () => {
  const runtime = await createApplication();
  await configureCallbackToken(runtime);

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/email/tencent/callback",
    headers: {},
    query: {
      token: CALLBACK_TOKEN,
    },
    body: {
      event: "bounce",
      eventid: 1,
      email: "reader@example.com",
      timestamp: 1761555500,
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "REQ_INVALID_BODY");

  const invalidEventIdResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/email/tencent/callback",
    headers: {},
    query: {
      token: CALLBACK_TOKEN,
    },
    body: {
      event: "bounce",
      eventid: "not-a-number",
      email: "reader@example.com",
      timestamp: 1761555500,
    },
  });

  assert.equal(invalidEventIdResponse.statusCode, 400);
  assert.equal(invalidEventIdResponse.body.code, "REQ_INVALID_BODY");

  const stringEventIdResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/email/tencent/callback",
    headers: {},
    query: {
      token: CALLBACK_TOKEN,
    },
    body: {
      event: "bounce",
      eventid: "3",
      email: "reader@example.com",
      timestamp: 1761555500,
    },
  });

  assert.equal(stringEventIdResponse.statusCode, 400);
  assert.equal(stringEventIdResponse.body.code, "REQ_INVALID_BODY");
  assert.equal(runtime.database.emailDeliveryEvents.length, 0);
});

test("admin email event list requires admin authentication", async () => {
  const runtime = await createApplication();

  const response = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/common/email-service/events",
    headers: {},
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.code, "ADMIN_AUTH_REQUIRED");
});
