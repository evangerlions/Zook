import assert from "node:assert/strict";
import test from "node:test";

import { createLlmSmokeSummaryPresentation, sortLlmSmokeItems } from "../../apps/admin-web/app/lib/llm-smoke-presentation.ts";
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

test("LLM smoke results sort by provider and then model while preserving route order on ties", () => {
  const items = [
    { provider: "bai", providerLabel: "B.AI", modelKey: "qwen3.8-flash", modelLabel: "Qwen 3.8 Flash", providerModel: "qwen3.8-flash" },
    { provider: "bailian", providerLabel: "百炼", modelKey: "qwen3.8-max", modelLabel: "Qwen 3.8 Max", providerModel: "qwen3.8-max" },
    { provider: "bai", providerLabel: "B.AI", modelKey: "deepseek-v4-flash", modelLabel: "DeepSeek V4 Flash", providerModel: "deepseek-v4-flash" },
    { provider: "bai", providerLabel: "B.AI", modelKey: "qwen3.8-flash", modelLabel: "Qwen 3.8 Flash", providerModel: "qwen3.8-flash-alt" },
  ] as AdminLlmSmokeTestDocument["items"];

  assert.deepEqual(
    sortLlmSmokeItems(items).map((item) => `${item.provider}/${item.modelKey}/${item.providerModel}`),
    [
      "bailian/qwen3.8-max/qwen3.8-max",
      "bai/deepseek-v4-flash/deepseek-v4-flash",
      "bai/qwen3.8-flash/qwen3.8-flash",
      "bai/qwen3.8-flash/qwen3.8-flash-alt",
    ],
  );
});
