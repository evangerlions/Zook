import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCallsOption,
  buildTokenRankingOption,
  formatLatency,
  formatPercent,
  successRateTone,
  tokenCoverage,
} from "../../apps/admin-web/app/components/llm-monitor/llm-monitor-view-model.ts";
import { buildRoutingComparisonOption } from "../../apps/admin-web/app/components/llm-monitor/routing-comparison-view-model.ts";
import {
  buildTopRoutingModelOptions,
  filterHealthFailures,
} from "../../apps/admin-web/app/components/llm-monitor/reliability-errors-view-model.ts";
import type { LlmHourlySeriesItem, LlmMetricsSummary } from "../../apps/admin-web/app/lib/types/llm.ts";

test("LLM monitor formatters keep units compact and missing values explicit", () => {
  assert.equal(formatLatency(undefined), "—");
  assert.equal(formatLatency(980), "980 ms");
  assert.equal(formatLatency(1250), "1.25 s");
  assert.equal(formatPercent(94.5), "94.5%");
  assert.equal(formatPercent(undefined), "—");
  assert.equal(successRateTone(100), "healthy");
  assert.equal(successRateTone(97), "warning");
  assert.equal(successRateTone(50), "critical");
  assert.equal(successRateTone(undefined), "unknown");
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

test("LLM routing share keeps exactly one row per model without current-target markers", () => {
  const option = buildRoutingComparisonOption([
    { modelKey: "model-a", provider: "provider-a", actualTrafficShare: 55 },
    { modelKey: "model-a", provider: "provider-b", actualTrafficShare: 45 },
    { modelKey: "model-b", provider: "provider-a", actualTrafficShare: 100 },
    { modelKey: "model-b", provider: "provider-b", actualTrafficShare: 0 },
  ], 1000) as {
    yAxis: { data: string[] };
    series: Array<{
      name: string;
      type: string;
      data: Array<number | { value: [number, string] }>;
    }>;
    tooltip: { formatter: (params: Array<{ axisValue: string }>) => string };
  };

  assert.deepEqual(option.yAxis.data, ["model-a", "model-b"]);
  assert.equal(option.series.find((series) => series.name === "provider-a")?.data[0], 55);
  assert.equal(option.series.some((series) => series.type === "scatter"), false);
  const tooltip = option.tooltip.formatter([{ axisValue: "model-a" }]);
  assert.match(tooltip, /provider-a  调用占比 55%/);
  assert.match(tooltip, /provider-b  调用占比 45%/);
  assert.doesNotMatch(tooltip, /目标/);
});

test("LLM error table offers the five most-used routing models and filters failures", () => {
  const routes = Array.from({ length: 7 }, (_, index) => ({
    routingModelKey: `model-${index}`,
    provider: "provider-a",
    providerModel: `upstream-${index}`,
    operation: "chat" as const,
    summary: { ...emptySummary(), requestCount: index * 10 },
    actualTrafficShare: 100,
  }));
  assert.deepEqual(
    buildTopRoutingModelOptions(routes).map((item) => item.modelKey),
    ["model-6", "model-5", "model-4", "model-3", "model-2"],
  );

  const failures = [
    {
      routingModelKey: "model-6",
      provider: "provider-a",
      providerModel: "upstream-6",
      operation: "chat" as const,
      errorCode: "rate_limit",
      errorMessage: "Too many requests",
      count: 4,
      lastOccurredAt: "2026-08-25T04:00:00.000Z",
    },
    {
      routingModelKey: "model-5",
      provider: "provider-b",
      providerModel: "upstream-5",
      operation: "chat" as const,
      errorCode: "timeout",
      count: 2,
      lastOccurredAt: "2026-08-25T03:00:00.000Z",
    },
  ];
  assert.deepEqual(filterHealthFailures(failures, "model-6"), [failures[0]]);
  assert.deepEqual(filterHealthFailures(failures, ""), failures);
});

function emptySummary(): LlmMetricsSummary {
  return {
    requestCount: 0,
    successCount: 0,
    failureCount: 0,
    timeoutCount: 0,
    cancelledCount: 0,
    latencySampleCount: 0,
    firstResponseSampleCount: 0,
    providerUsageCount: 0,
    estimatedUsageCount: 0,
    missingUsageCount: 0,
  };
}
