import assert from "node:assert/strict";
import test from "node:test";

import { adminApi } from "../../apps/admin-web/app/lib/admin-api.ts";
import {
  feedbackAttachmentDataUrl,
  feedbackAttachmentLabel,
  feedbackAttachmentMeta,
  feedbackMessagePreview,
  feedbackReplyImageLimitError,
  feedbackStatusColor,
  feedbackStatusLabel,
  feedbackUserLabel,
  FEEDBACK_REPLY_PRESETS,
} from "../../apps/admin-web/app/lib/feedback.ts";

test("admin web feedback helpers render list and attachment values", () => {
  assert.equal(feedbackMessagePreview("  hello\nworld  "), "hello world");
  assert.equal(feedbackMessagePreview("x".repeat(120), 10), "xxxxxxxxxx…");
  assert.equal(feedbackAttachmentLabel(0), "无图片");
  assert.equal(feedbackAttachmentLabel(3), "3 张图片");
  assert.equal(
    feedbackAttachmentMeta({
      id: "att_1",
      fileName: "screen.png",
      mimeType: "image/png",
      sizeBytes: 1536,
      width: 32,
      height: 16,
      createdAt: "2026-06-13T00:00:00.000Z",
    }),
    "image/png · 32×16 · 1.5 KB",
  );
  assert.equal(
    feedbackAttachmentDataUrl({
      id: "att_1",
      feedbackId: "feedback_1",
      fileName: "screen.png",
      mimeType: "image/png",
      sizeBytes: 1,
      contentBase64: "AA==",
      createdAt: "2026-06-13T00:00:00.000Z",
    }),
    "data:image/png;base64,AA==",
  );
  assert.equal(
    feedbackUserLabel({
      id: "feedback_1",
      appId: "ai_novel",
      userId: "user_1",
      userEmail: "writer@example.com",
      message: "hello",
      status: "new",
      attachmentCount: 0,
      attachments: [],
      createdAt: "2026-06-13T00:00:00.000Z",
      updatedAt: "2026-06-13T00:00:00.000Z",
    }),
    "writer@example.com",
  );
  assert.equal(feedbackStatusLabel("new"), "新反馈");
  assert.equal(feedbackStatusColor("done"), "green");
  assert.equal(feedbackStatusLabel("done"), "已结单");
});

test("feedback presets preserve both suggestion replies and the approved honorific", () => {
  assert.equal(FEEDBACK_REPLY_PRESETS.length, 5);
  assert.deepEqual(FEEDBACK_REPLY_PRESETS.slice(0, 2), [
    { label: "收到建议 · 回复 1", message: "感谢您给我们留言！我们会认真考虑您的建议。" },
    { label: "收到建议 · 回复 2", message: "感谢您给我们留言！我们已将其记录在需求池中。" },
  ]);
  assert.ok(FEEDBACK_REPLY_PRESETS.every(({ message }) => !message.includes("你")));
});

test("feedback reply image limits combine already selected images with new images", () => {
  const existing = Array.from({ length: 19 }, () => ({ size: 1 }));
  const exactBytes = 10 * 1024 * 1024;
  assert.equal(feedbackReplyImageLimitError([...existing, { size: exactBytes - 19 }]), undefined);
  assert.match(feedbackReplyImageLimitError([...existing, { size: exactBytes - 18 }]) ?? "", /10 MB/);
  assert.match(feedbackReplyImageLimitError([...existing, { size: 1 }, { size: 1 }]) ?? "", /20 张/);
});

test("admin web feedback API client uses AINovel private admin routes and status query", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ path: string; method?: string; body?: string }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = typeof input === "string" ? input : input.toString();
    requests.push({
      path,
      method: init?.method,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return new Response(JSON.stringify({
      code: "OK",
      message: "ok",
      data: path.includes("/status")
        ? { app: "ai_novel", id: "feedback 1", status: "doing", updatedAt: "2026-06-13T00:01:00.000Z" }
        : path.includes("/attachments/")
          ? {
            id: "att_1",
            feedbackId: "feedback_1",
            fileName: "screen.png",
            mimeType: "image/png",
            sizeBytes: 1,
            contentBase64: "AA==",
            createdAt: "2026-06-13T00:00:00.000Z",
          }
          : { app: "ai_novel", items: [] },
      requestId: "req_test",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await adminApi.getAiNovelFeedback({ limit: 50, status: "doing", needsReply: true });
    await adminApi.getAiNovelFeedbackAttachment("feedback 1", "att/1");
    await adminApi.updateAiNovelFeedbackStatus("feedback 1", "doing");
    await adminApi.getAiNovelFeedbackThread("feedback 1", "older/+1");
    await adminApi.replyToAiNovelFeedback("feedback 1", {
      attachments: [{ fileName: "screen.png", mimeType: "image/png", sizeBytes: 1, contentBase64: "AA==" }],
      submissionKey: "feedback-submission-1",
      close: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map((item) => item.path), [
    "/api/v1/admin/apps/ai_novel/feedback?limit=50&status=doing&needsReply=true",
    "/api/v1/admin/apps/ai_novel/feedback/feedback%201/attachments/att%2F1",
    "/api/v1/admin/apps/ai_novel/feedback/feedback%201/status",
    "/api/v1/admin/apps/ai_novel/feedback/feedback%201?cursor=older%2F%2B1",
    "/api/v1/admin/apps/ai_novel/feedback/feedback%201/messages",
  ]);
  assert.equal(requests[2]?.method, "PATCH");
  assert.equal(requests[2]?.body, JSON.stringify({ status: "doing" }));
  assert.equal(requests[4]?.method, "POST");
  assert.deepEqual(JSON.parse(requests[4]!.body!), {
    attachments: [{ fileName: "screen.png", mimeType: "image/png", sizeBytes: 1, contentBase64: "AA==" }],
    submissionKey: "feedback-submission-1",
    close: true,
  });
});
