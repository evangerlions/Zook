import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";

async function loginAiNovel(runtime: Awaited<ReturnType<typeof createApplication>>) {
  return await runtime.services.authService.login({
    appId: "ai_novel",
    account: "alice@example.com",
    password: "Password1234",
  });
}

async function loginAdmin(runtime: Awaited<ReturnType<typeof createApplication>>) {
  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/auth/login",
    headers: {},
    body: {
      username: "admin",
      password: "AdminPass123!",
    },
  });
  assert.equal(response.statusCode, 200);
  const cookie = response.headers?.["Set-Cookie"];
  assert.ok(cookie);
  return cookie;
}

function tempStorageRoot() {
  return mkdtempSync(join(tmpdir(), "zook-feedback-"));
}

function samplePngBase64() {
  return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lH2m8QAAAABJRU5ErkJggg==";
}

function samplePngBytes() {
  return Buffer.from(samplePngBase64(), "base64");
}

test("AI Novel feedback requires auth", async () => {
  const runtime = await createApplication();

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/feedback",
    headers: {},
    body: {
      message: "hello",
    },
  });

  assert.equal(response.statusCode, 401);
});

test("AI Novel feedback rejects empty text and picture-only submissions", async () => {
  const runtime = await createApplication();
  const session = await loginAiNovel(runtime);

  for (const body of [
    { message: "   " },
    { message: "Too short feedback text." },
    {
      message: "",
      attachments: [
        {
          fileName: "screen.png",
          mimeType: "image/png",
          contentBase64: samplePngBase64(),
          sizeBytes: samplePngBytes().length,
        },
      ],
    },
  ]) {
    const response = await runtime.app.handle({
      method: "POST",
      path: "/api/v1/ai_novel/feedback",
      headers: {
        authorization: `Bearer ${session.accessToken}`,
      },
      body,
      ipAddress: "198.51.100.44",
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, "REQ_INVALID_BODY");
  }
  assert.equal(runtime.database.feedbackRecords.length, 0);
});

test("AI Novel feedback persists text-only submissions and audit action", async () => {
  const runtime = await createApplication();
  const session = await loginAiNovel(runtime);

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/feedback",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-platform": "ios",
      "x-app-version": "1.0.0",
    },
    body: {
      message: "  The settings page needs a feedback entry.  ",
    },
    ipAddress: "198.51.100.45",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.accepted, true);
  assert.equal(response.body.data.attachmentCount, 0);
  assert.equal(runtime.database.feedbackRecords.length, 1);
  assert.equal(runtime.database.feedbackRecords[0]?.message, "The settings page needs a feedback entry.");
  assert.equal(runtime.database.feedbackRecords[0]?.platform, "ios");
  assert.equal(runtime.database.feedbackRecords[0]?.status, "new");
  assert.ok(runtime.database.auditLogs.some((item) => item.action === "feedback.submit"));
});

test("AI Novel feedback writes private appRunData attachments and admin can fetch them", async () => {
  const storageRoot = tempStorageRoot();
  const runtime = await createApplication({
    fileStorageRoot: storageRoot,
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });
  const session = await loginAiNovel(runtime);

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/feedback",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
    },
    body: {
      message: "Screenshot attached with enough detail for support.",
      attachments: [
        {
          fileName: "screen.png",
          mimeType: "image/png",
          contentBase64: samplePngBase64(),
          sizeBytes: samplePngBytes().length,
          width: 1,
          height: 1,
        },
      ],
    },
    ipAddress: "198.51.100.46",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(runtime.database.feedbackAttachments.length, 1);
  const attachment = runtime.database.feedbackAttachments[0];
  assert.ok(attachment);
  assert.match(
    attachment.storagePath,
    /^feedback\/ai_novel\/\d{4}-\d{2}-\d{2}\/feedback_[a-f0-9]+\/fb_att_[a-f0-9]+\.png$/,
  );
  assert.deepEqual(readFileSync(join(storageRoot, attachment.storagePath)), samplePngBytes());

  const anonymousList = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/ai_novel/feedback",
    headers: {},
  });
  assert.equal(anonymousList.statusCode, 401);

  const adminCookie = await loginAdmin(runtime);
  const listResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/ai_novel/feedback",
    headers: {
      cookie: adminCookie,
    },
  });
  assert.equal(listResponse.statusCode, 200);
  assert.equal(listResponse.body.data.items.length, 1);
  assert.equal(listResponse.body.data.items[0].status, "new");
  assert.equal(listResponse.body.data.items[0].attachments[0].mimeType, "image/png");

  const attachmentResponse = await runtime.app.handle({
    method: "GET",
    path: `/api/v1/admin/apps/ai_novel/feedback/${response.body.data.id}/attachments/${attachment.id}`,
    headers: {
      cookie: adminCookie,
    },
  });
  assert.equal(attachmentResponse.statusCode, 200);
  assert.equal(attachmentResponse.body.data.contentBase64, samplePngBase64());
});

test("AI Novel feedback admin can filter and update status", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });
  const session = await loginAiNovel(runtime);

  const first = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/feedback",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
    },
    body: {
      message: "First feedback item needs triage by support.",
    },
    ipAddress: "198.51.100.61",
  });
  const second = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/feedback",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
    },
    body: {
      message: "Second feedback item is ready to move into doing.",
    },
    ipAddress: "198.51.100.62",
  });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);

  const adminCookie = await loginAdmin(runtime);
  const updateResponse = await runtime.app.handle({
    method: "PATCH",
    path: `/api/v1/admin/apps/ai_novel/feedback/${second.body.data.id}/status`,
    headers: {
      cookie: adminCookie,
    },
    body: {
      status: "doing",
    },
  });
  assert.equal(updateResponse.statusCode, 200);
  assert.equal(updateResponse.body.data.status, "doing");

  const filtered = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/ai_novel/feedback",
    headers: {
      cookie: adminCookie,
    },
    query: {
      status: "doing",
    },
  });
  assert.equal(filtered.statusCode, 200);
  assert.deepEqual(
    filtered.body.data.items.map((item: { id: string }) => item.id),
    [second.body.data.id],
  );

  const invalidStatus = await runtime.app.handle({
    method: "PATCH",
    path: `/api/v1/admin/apps/ai_novel/feedback/${first.body.data.id}/status`,
    headers: {
      cookie: adminCookie,
    },
    body: {
      status: "archived",
    },
  });
  assert.equal(invalidStatus.statusCode, 400);
  assert.equal(invalidStatus.body.code, "REQ_INVALID_BODY");
});

test("AI Novel feedback rejects invalid images, too many images, over-limit text, and rate limit", async () => {
  const runtime = await createApplication();
  const session = await loginAiNovel(runtime);

  const invalidMime = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/feedback",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
    },
    body: {
      message: "Invalid image upload should be rejected.",
      attachments: [{
        fileName: "screen.txt",
        mimeType: "text/plain",
        contentBase64: samplePngBase64(),
        sizeBytes: samplePngBytes().length,
      }],
    },
    ipAddress: "198.51.100.47",
  });
  assert.equal(invalidMime.statusCode, 400);

  const fakeImageBytes = Buffer.from("feedback-image");
  const fakeImage = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/feedback",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
    },
    body: {
      message: "Fake image bytes should be rejected.",
      attachments: [{
        fileName: "screen.png",
        mimeType: "image/png",
        contentBase64: fakeImageBytes.toString("base64"),
        sizeBytes: fakeImageBytes.length,
      }],
    },
    ipAddress: "198.51.100.47",
  });
  assert.equal(fakeImage.statusCode, 400);

  const missingFields = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/feedback",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
    },
    body: {
      message: "Missing required attachment fields.",
      attachments: [{ mimeType: "image/png", contentBase64: samplePngBase64() }],
    },
    ipAddress: "198.51.100.47",
  });
  assert.equal(missingFields.statusCode, 400);

  const tooMany = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/feedback",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
    },
    body: {
      message: "Too many images should be rejected.",
      attachments: Array.from({ length: 6 }, () => ({
        mimeType: "image/png",
        contentBase64: samplePngBase64(),
      })),
    },
    ipAddress: "198.51.100.48",
  });
  assert.equal(tooMany.statusCode, 400);

  const tooLong = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/feedback",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
    },
    body: {
      message: "x".repeat(10_001),
    },
    ipAddress: "198.51.100.49",
  });
  assert.equal(tooLong.statusCode, 400);

  for (let index = 0; index < 5; index += 1) {
    const accepted = await runtime.app.handle({
      method: "POST",
      path: "/api/v1/ai_novel/feedback",
      headers: {
        authorization: `Bearer ${session.accessToken}`,
      },
      body: {
        message: `Rate-limit sample ${index} with enough detail.`,
      },
      ipAddress: "198.51.100.50",
    });
    assert.equal(accepted.statusCode, 200);
  }

  const limited = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/feedback",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
    },
    body: {
      message: "Rate-limit sample 6 with enough detail.",
    },
    ipAddress: "198.51.100.50",
  });
  assert.equal(limited.statusCode, 429);
});
