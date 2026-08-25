import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCallsOption,
  buildTokenRankingOption,
  formatLatency,
  formatPercent,
  tokenCoverage,
} from "../../apps/admin-web/app/components/llm-monitor/llm-monitor-view-model.ts";
import type { LlmHourlySeriesItem, LlmMetricsSummary } from "../../apps/admin-web/app/lib/types/llm.ts";

test("LLM monitor formatters keep units compact and missing values explicit", () => {
  assert.equal(formatLatency(undefined), "—");
  assert.equal(formatLatency(980), "980 ms");
  assert.equal(formatLatency(1250), "1.25 s");
  assert.equal(formatPercent(94.5), "94.5%");
});

test("LLM call trend omits reliability points with no reliability samples", () => {
  const item: LlmHourlySeriesItem = {
    bucket: "2026-08-25T10",
    available: true,
    ...emptySummary(),
  };
  const option = buildCallsOption([item]) as {
    series: Array<{ data: Array<number | null> }>;
  };
  assert.deepEqual(option.series[0]?.data, [0]);
  assert.deepEqual(option.series[1]?.data, [null]);
});

test("LLM token ranking keeps four non-overlapping token components", () => {
  const summary = {
    ...emptySummary(),
    requestCount: 10,
    promptTokens: 100,
    visibleOutputTokens: 40,
    reasoningTokens: 30,
    unclassifiedTokens: 5,
    totalTokens: 175,
    providerUsageCount: 8,
    estimatedUsageCount: 2,
  };
  const option = buildTokenRankingOption([{ label: "model-a", summary }]) as {
    series: Array<{ name: string }>;
  };
  assert.deepEqual(option.series.map((item) => item.name), [
    "Prompt",
    "可见输出",
    "Reasoning",
    "未分类",
  ]);
  assert.match(tokenCoverage(summary), /Provider 80%/);
  assert.match(tokenCoverage(summary), /估算 20%/);
});

function emptySummary(): LlmMetricsSummary {
  return {
    requestCount: 0,
    successCount: 0,
    failureCount: 0,
    timeoutCount: 0,
    cancelledCount: 0,
    successRate: 100,
    latencySampleCount: 0,
    firstResponseSampleCount: 0,
    providerUsageCount: 0,
    estimatedUsageCount: 0,
    missingUsageCount: 0,
  };
}
