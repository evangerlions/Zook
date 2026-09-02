import type { EChartsCoreOption } from "echarts/core";

import type {
  LlmHourlySeriesItem,
  LlmMetricsSummary,
} from "../../lib/types";

const COLORS = {
  blue: "#2563eb",
  cyan: "#0891b2",
  amber: "#d97706",
  violet: "#7c3aed",
  slate: "#64748b",
};

export type SuccessRateTone = "healthy" | "warning" | "critical" | "unknown";

export function successRateTone(value?: number): SuccessRateTone {
  if (value === undefined) return "unknown";
  if (value >= 99) return "healthy";
  if (value >= 95) return "warning";
  return "critical";
}

export function formatMetricNumber(value?: number): string {
  return value === undefined ? "—" : new Intl.NumberFormat("zh-CN").format(value);
}

export function formatLatency(value?: number): string {
  if (value === undefined) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 1 : 2)} s` : `${value} ms`;
}

export function formatPercent(value?: number): string {
  return value === undefined ? "—" : `${value.toFixed(2).replace(/\.?0+$/, "")}%`;
}

export function tokenCoverage(summary: LlmMetricsSummary): string {
  const measured = summary.providerUsageCount + summary.estimatedUsageCount;
  if (!summary.requestCount) return "暂无调用";
  return `Provider ${formatPercent((summary.providerUsageCount / summary.requestCount) * 100)} · 估算 ${formatPercent((summary.estimatedUsageCount / summary.requestCount) * 100)} · 缺失 ${summary.missingUsageCount}`;
}

export function buildCallsOption(items: LlmHourlySeriesItem[], width = 1000): EChartsCoreOption {
  const compact = width < 520;
  const labels = items.map((item) => shortBucket(item.bucket));
  return {
    color: [COLORS.blue, COLORS.cyan],
    tooltip: {
      trigger: "axis",
      confine: true,
      formatter: (params: Array<{ dataIndex: number }>) => {
        const item = items[params[0]?.dataIndex ?? -1];
        if (!item) return "无数据";
        return [
          item.bucket,
          `调用 ${formatMetricNumber(item.requestCount)}`,
          `成功 ${item.successCount} · 失败 ${item.failureCount} · 超时 ${item.timeoutCount} · 取消 ${item.cancelledCount}`,
          `上游调用成功率 ${formatPercent(item.successRate)}`,
        ].join("<br/>");
      },
    },
    legend: { top: 0, itemGap: compact ? 8 : 20, textStyle: { fontSize: compact ? 10 : 12 }, data: ["调用次数", "上游调用成功率"] },
    grid: { top: 48, left: compact ? 34 : 52, right: compact ? 34 : 52, bottom: 42, containLabel: true },
    xAxis: { type: "category", data: labels, axisLabel: { fontSize: compact ? 9 : 12, hideOverlap: true } },
    yAxis: [
      { type: "value", name: compact ? "" : "调用", minInterval: 1, splitNumber: compact ? 2 : 5, axisLabel: { fontSize: compact ? 9 : 12 } },
      { type: "value", name: compact ? "" : "%", min: 0, max: 100, splitNumber: compact ? 2 : 5, axisLabel: { fontSize: compact ? 9 : 12 } },
    ],
    series: [
      {
        name: "调用次数",
        type: "bar",
        barMaxWidth: 22,
        data: items.map((item) => item.available ? item.requestCount : null),
      },
      {
        name: "上游调用成功率",
        type: "line",
        yAxisIndex: 1,
        symbolSize: 5,
        smooth: 0.2,
        data: items.map((item) => item.available &&
          item.successCount + item.failureCount + item.timeoutCount > 0
          ? item.successRate
          : null),
      },
    ],
  };
}

export function buildTokenOption(items: LlmHourlySeriesItem[], width = 1000): EChartsCoreOption {
  const compact = width < 520;
  const labels = items.map((item) => shortBucket(item.bucket));
  const series = [
    ["Prompt", "promptTokens", COLORS.blue],
    ["可见输出", "visibleOutputTokens", COLORS.cyan],
    ["Reasoning", "reasoningTokens", COLORS.violet],
    ["未分类", "unclassifiedTokens", COLORS.slate],
  ] as const;
  return {
    color: series.map((item) => item[2]),
    tooltip: {
      trigger: "axis",
      confine: true,
      formatter: (params: Array<{ dataIndex: number }>) => {
        const item = items[params[0]?.dataIndex ?? -1];
        if (!item) return "无数据";
        return [
          item.bucket,
          `Prompt ${formatMetricNumber(item.promptTokens)}`,
          `可见输出 ${formatMetricNumber(item.visibleOutputTokens)}`,
          `Reasoning ${formatMetricNumber(item.reasoningTokens)}`,
          `未分类 ${formatMetricNumber(item.unclassifiedTokens)}`,
          `canonical 总 Token ${formatMetricNumber(item.totalTokens)}`,
          `Provider ${item.providerUsageCount} · 估算 ${item.estimatedUsageCount} · 缺失 ${item.missingUsageCount}`,
        ].join("<br/>");
      },
    },
    legend: { top: 0, type: "scroll", itemGap: compact ? 8 : 20, textStyle: { fontSize: compact ? 10 : 12 } },
    grid: { top: 48, left: compact ? 36 : 58, right: compact ? 12 : 24, bottom: 42, containLabel: true },
    xAxis: { type: "category", data: labels, axisLabel: { fontSize: compact ? 9 : 12, hideOverlap: true } },
    yAxis: { type: "value", name: compact ? "" : "Token", splitNumber: compact ? 2 : 5, axisLabel: { fontSize: compact ? 9 : 12, formatter: (value: number) => compactNumber(value) } },
    series: series.map(([name, field]) => ({
      name,
      type: "line",
      stack: "tokens",
      areaStyle: { opacity: 0.18 },
      showSymbol: false,
      data: items.map((item) => item.available ? (item[field] ?? 0) : null),
    })),
  };
}

export function buildLatencyOption(items: LlmHourlySeriesItem[], width = 1000): EChartsCoreOption {
  const compact = width < 520;
  return {
    color: [COLORS.blue, COLORS.amber, COLORS.cyan, COLORS.violet],
    tooltip: {
      trigger: "axis",
      confine: true,
      formatter: (params: Array<{ dataIndex: number }>) => {
        const item = items[params[0]?.dataIndex ?? -1];
        if (!item) return "无数据";
        return [
          item.bucket,
          `P50/P95 总延迟 ${formatLatency(item.p50TotalLatencyMs)} / ${formatLatency(item.p95TotalLatencyMs)}（${item.latencySampleCount} 样本）`,
          `P50/P95 首响应 ${formatLatency(item.p50FirstByteLatencyMs)} / ${formatLatency(item.p95FirstByteLatencyMs)}（${item.firstResponseSampleCount} 样本）`,
        ].join("<br/>");
      },
    },
    legend: { top: 0, type: "scroll", textStyle: { fontSize: compact ? 10 : 12 } },
    grid: { top: 50, left: compact ? 36 : 58, right: compact ? 12 : 24, bottom: 42, containLabel: true },
    xAxis: {
      type: "category",
      data: items.map((item) => shortBucket(item.bucket)),
      axisLabel: { fontSize: compact ? 9 : 12, hideOverlap: true },
    },
    yAxis: { type: "value", name: compact ? "" : "ms", splitNumber: compact ? 2 : 5, axisLabel: { fontSize: compact ? 9 : 12 } },
    series: [
      ["P50 总延迟", "p50TotalLatencyMs"],
      ["P95 总延迟", "p95TotalLatencyMs"],
      ["P50 首响应", "p50FirstByteLatencyMs"],
      ["P95 首响应", "p95FirstByteLatencyMs"],
    ].map(([name, field]) => ({
      name,
      type: "line",
      showSymbol: false,
      smooth: 0.2,
      data: items.map((item) => item.available
        ? (item[field as keyof LlmHourlySeriesItem] as number | undefined) ?? null
        : null),
    })),
  };
}

export function buildTokenRankingOption(
  items: Array<{ label: string; summary: LlmMetricsSummary }>,
): EChartsCoreOption {
  const ranked = [...items]
    .sort((left, right) => (right.summary.totalTokens ?? 0) - (left.summary.totalTokens ?? 0))
    .slice(0, 10)
    .reverse();
  const series = [
    ["Prompt", "promptTokens"],
    ["可见输出", "visibleOutputTokens"],
    ["Reasoning", "reasoningTokens"],
    ["未分类", "unclassifiedTokens"],
  ] as const;
  return {
    color: [COLORS.blue, COLORS.cyan, COLORS.violet, COLORS.slate],
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { top: 0 },
    grid: { top: 48, left: 112, right: 16, bottom: 30, containLabel: false },
    xAxis: {
      type: "value",
      name: "Token",
      splitNumber: 2,
      axisLabel: { fontSize: 10, formatter: (value: number) => compactNumber(value) },
    },
    yAxis: {
      type: "category",
      data: ranked.map((item) => item.label),
      axisLabel: { fontSize: 10, formatter: (value: string) => value.length > 12 ? `${value.slice(0, 11)}…` : value },
    },
    series: series.map(([name, field]) => ({
      name,
      type: "bar",
      stack: "tokens",
      barMaxWidth: 22,
      data: ranked.map((item) => item.summary[field] ?? 0),
    })),
  };
}

function shortBucket(bucket: string): string {
  return bucket.includes("T") ? bucket.slice(5).replace("T", " ") : bucket.slice(5);
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
