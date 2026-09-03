import assert from "node:assert/strict";
import test from "node:test";

import { createLlmSmokeSummaryPresentation } from "../../apps/admin-web/app/lib/llm-smoke-presentation.ts";
import type { AdminLlmSmokeTestDocument } from "../../apps/admin-web/app/lib/types/llm.ts";

function createSmokeDocument(
  overrides: Partial<AdminLlmSmokeTestDocument> = {},
): AdminLlmSmokeTestDocument {
  return {
    executedAt: "2026-08-04T10:00:00.000Z",
    cooldownSeconds: 10,
    target: { mode: "matrix" },
    summary: {
      totalCount: 1,
      attemptedCount: 1,
      successCount: 1,
      failureCount: 0,
      skippedCount: 0,
      successRate: 100,
    },
    items: [],
    ...overrides,
  };
}

test("LLM smoke summary presents successful matrix runs", () => {
  assert.deepEqual(
    createLlmSmokeSummaryPresentation(createSmokeDocument()),
    {
      scope: "全量矩阵",
      statusLabel: "运行正常",
      statusTone: "success",
    },
  );
});

test("LLM smoke summary prioritizes route failures", () => {
  const document = createSmokeDocument({
    target: {
      mode: "route",
      modelKey: "deepseek-v4-flash-latest",
      provider: "openrouter",
    },
    summary: {
      totalCount: 1,
      attemptedCount: 1,
      successCount: 0,
      failureCount: 1,
      skippedCount: 0,
      successRate: 0,
    },
  });

  assert.deepEqual(
    createLlmSmokeSummaryPresentation(document),
    {
      scope: "deepseek-v4-flash-latest / openrouter",
      statusLabel: "存在失败",
      statusTone: "failed",
    },
  );
});

test("LLM smoke summary labels runs without executable routes", () => {
  const document = createSmokeDocument({
    summary: {
      totalCount: 0,
      attemptedCount: 0,
      successCount: 0,
      failureCount: 0,
      skippedCount: 0,
      successRate: 0,
    },
  });

  assert.deepEqual(createLlmSmokeSummaryPresentation(document), {
    scope: "全量矩阵",
    statusLabel: "没有可执行路由",
    statusTone: "neutral",
  });
});
