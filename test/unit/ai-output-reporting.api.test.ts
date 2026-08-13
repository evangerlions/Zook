import assert from "node:assert/strict";
import test from "node:test";
import { sha256 } from "../../src/shared/utils.ts";
import { createApplication } from "../support/create-test-application.ts";

async function loginAiNovel(
  runtime: Awaited<ReturnType<typeof createApplication>>,
) {
  return await runtime.services.authService.login({
    appId: "ai_novel",
    account: "alice@example.com",
    password: "Password1234",
  });
}

async function loginAdmin(
  runtime: Awaited<ReturnType<typeof createApplication>>,
) {
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

function chatReportBody(content = "Unsafe generated response") {
  return {
    submissionId: "client-report-1",
    targetType: "chat_message",
    targetId: "message-1",
    messageId: "message-1",
    sessionId: "session-1",
    scene: "write",
    category: "harmful_unsafe",
    description: "The answer encourages unsafe behavior.",
    reportedContent: content,
    contentHash: `sha256:${sha256(content)}`,
    clientRegion: "CN",
    effectiveRegion: "CN",
  };
}

test("AI output reporting requires an authenticated AINovel account", async () => {
  const runtime = await createApplication();
  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai-output-reports",
    headers: {},
    body: chatReportBody(),
  });

  assert.equal(response.statusCode, 401);
  assert.equal(runtime.database.aiOutputReportRecords.length, 0);
});

test("AI output reports are encrypted, idempotent, and auditable", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });
  const session = await loginAiNovel(runtime);
  const headers = {
    authorization: `Bearer ${session.accessToken}`,
    "x-platform": "ios",
    "x-app-version": "1.3.0",
  };

  const first = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai-output-reports",
    headers,
    body: chatReportBody(),
  });
  const duplicate = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai-output-reports",
    headers,
    body: chatReportBody(),
  });

  assert.equal(first.statusCode, 200);
  assert.equal(duplicate.statusCode, 200);
  assert.equal(
    duplicate.body.data.reportId,
    first.body.data.reportId,
  );
  assert.equal(runtime.database.aiOutputReportRecords.length, 1);
  const stored = runtime.database.aiOutputReportRecords[0];
  assert.ok(stored);
  assert.notEqual(
    stored.encryptedContentCiphertextBase64,
    chatReportBody().reportedContent,
  );
  assert.equal(
    JSON.stringify(stored).includes(chatReportBody().reportedContent),
    false,
  );

  const adminCookie = await loginAdmin(runtime);
  const detail = await runtime.app.handle({
    method: "GET",
    path:
      `/api/v1/admin/apps/ai_novel/ai-output-reports/${first.body.data.reportId}`,
    headers: { cookie: adminCookie },
  });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.body.data.reportedContent, chatReportBody().reportedContent);

  const status = await runtime.app.handle({
    method: "PATCH",
    path:
      `/api/v1/admin/apps/ai_novel/ai-output-reports/${first.body.data.reportId}/status`,
    headers: { cookie: adminCookie },
    body: {
      status: "resolved",
      resolutionCode: "content_removed",
    },
  });
  assert.equal(status.statusCode, 200);
  assert.equal(status.body.data.status, "resolved");
  assert.ok(
    runtime.database.auditLogs.some(
      (item) => item.action === "ai_output_report.submit",
    ),
  );
  assert.ok(
    runtime.database.auditLogs.some(
      (item) => item.action === "ai_output_report.admin_read",
    ),
  );
});

test("AI output reporting accepts zero-based chapter ids", async () => {
  const runtime = await createApplication();
  const session = await loginAiNovel(runtime);
  const headers = {
    authorization: `Bearer ${session.accessToken}`,
  };
  const invalid = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai-output-reports",
    headers,
    body: {
      ...chatReportBody(),
      contentHash: "sha256:not-the-content",
    },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(runtime.database.aiOutputReportRecords.length, 0);

  const chapterContent = "chapter";
  const report = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai-output-reports",
    headers,
    body: {
      submissionId: "client-chapter-report-1",
      targetType: "chapter_revision",
      targetId: "revision-0",
      chapterId: 0,
      chapterRevisionId: "revision-0",
      scene: "write",
      category: "misinformation",
      reportedContent: chapterContent,
      contentHash: `sha256:${sha256(chapterContent)}`,
    },
  });
  assert.equal(report.statusCode, 200);
  assert.equal(runtime.database.aiOutputReportRecords[0]?.chapterId, 0);

  const reaction = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai-output-reactions",
    headers,
    body: {
      submissionId: "client-reaction-1",
      targetType: "chapter_revision",
      targetId: "revision-0",
      reaction: "like",
      chapterId: 0,
      chapterRevisionId: "revision-0",
      contentHash: `sha256:${sha256(chapterContent)}`,
    },
  });
  assert.equal(reaction.statusCode, 200);
  assert.equal(reaction.body.data.accepted, true);
  assert.equal(runtime.database.aiOutputReactionRecords.length, 1);
  assert.equal(runtime.database.aiOutputReactionRecords[0]?.chapterId, 0);
});
