import assert from "node:assert/strict";
import test from "node:test";

import { mapAndLogAiNovelUpstreamError } from "../../src/modules/ai-novel/ai-novel-upstream-errors.ts";
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
