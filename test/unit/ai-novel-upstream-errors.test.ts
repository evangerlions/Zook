import assert from "node:assert/strict";
import test from "node:test";

import {
  logAiNovelRejectedChapterInput,
  mapAndLogAiNovelUpstreamError,
} from "../../src/modules/ai-novel/ai-novel-upstream-errors.ts";
import { StructuredLogger } from "../../src/infrastructure/logging/pino-logger.module.ts";
import { ApplicationError } from "../../src/shared/errors.ts";

function mapProviderFailure(details: Record<string, unknown>): ApplicationError {
  const mapped = mapAndLogAiNovelUpstreamError(
    new ApplicationError(
      Number(details.statusCode ?? 502),
      "LLM_PROVIDER_REQUEST_FAILED",
      String(details.message ?? "Provider request failed"),
      details,
    ),
    {
      stage: "chat",
      sceneKey: "write_turn",
      sceneRouteKey: "write_turn",
    },
  );
  assert.ok(mapped instanceof ApplicationError);
  return mapped;
}

test("maps provider context overflow to the explicit context-too-long code", () => {
  const mapped = mapProviderFailure({
    statusCode: 400,
    errorCode: "context_length_exceeded",
    message: "This model's maximum context length is 32768 tokens.",
  });

  assert.equal(mapped.code, "AI_CONTEXT_TOO_LONG");
  assert.equal(mapped.statusCode, 413);
});

test("keeps quota distinct from rate limiting before generic 400 mapping", () => {
  const quota = mapProviderFailure({
    statusCode: 429,
    errorCode: "insufficient_quota",
    message: "Insufficient quota for this request.",
  });
  const rateLimited = mapProviderFailure({
    statusCode: 429,
    errorCode: "rate_limit_exceeded",
    message: "Rate limit exceeded.",
  });

  assert.equal(quota.code, "AI_UPSTREAM_QUOTA_EXHAUSTED");
  assert.equal(rateLimited.code, "AI_UPSTREAM_RATE_LIMITED");
});

test("does not treat generic insufficient-input failures as quota errors", () => {
  const mapped = mapProviderFailure({
    statusCode: 400,
    errorCode: "invalid_request",
    message: "Insufficient arguments in request body.",
  });

  assert.equal(mapped.code, "AI_UPSTREAM_INVALID_REQUEST");
});

test("logs untruncated chapter draft input for moderation failures across providers", () => {
  const text = "示例正文\n".repeat(1000);
  const context = {
    requestId: "req_test",
    sceneKey: "chapter_draft",
    modelKey: "test-model",
    messages: [{ role: "user", content: text, reasoningContent: "omitted" }],
  } as const;
  const sensitive = "LLM_PROVIDER_CONTENT_SENSITIVE";
  const failed = "LLM_PROVIDER_REQUEST_FAILED";
  const examples = [
    [sensitive, "bailian_token_plan", {}, "Input text data may contain inappropriate content.", true],
    [sensitive, "another-provider", {}, "Content moderation rejected the request.", true],
    [failed, "volcengine", { errorCode: "InputTextSensitiveContentDetected.PolicyViolation" }, "Request rejected", true],
    [failed, "volcengine_agent_plan", { errorCode: "OutputTextRiskDetection" }, "Request rejected", false],
    [failed, "openrouter", { statusCode: 403, moderationDirection: "input" }, "Request rejected", true],
    [failed, "openrouter", { statusCode: 403, moderationDirection: "output" }, "Request rejected", false],
    [failed, "openrouter", { statusCode: 403 }, "Forbidden", false],
    [failed, "bai", { statusCode: 429 }, "Rate limited", false],
    [sensitive, "bailian", {}, "Output text data may contain inappropriate content.", false],
  ] as const;
  for (const [code, provider, details, message, logsInput] of examples) {
    const logger = new StructuredLogger("test", { emitToConsole: false });
    const error = new ApplicationError(400, code, message, { ...details, provider });
    logAiNovelRejectedChapterInput(error, context, logger);
    logAiNovelRejectedChapterInput(error, { ...context, sceneKey: "import_chapter_segmentation" }, logger);
    assert.equal(logger.records.length, logsInput ? 1 : 0, `${provider}: ${message}`);
    if (!logsInput) continue;
    const [log] = logger.records;
    assert.equal(log?.requestId, "req_test");
    assert.equal(log?.provider, provider);
    assert.deepEqual(log?.rejectedInput, [{ role: "user", content: text }]);
  }
});
