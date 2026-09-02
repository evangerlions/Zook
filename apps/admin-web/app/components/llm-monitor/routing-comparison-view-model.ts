import type { EChartsCoreOption } from "echarts/core";

import { formatPercent } from "./llm-monitor-view-model.ts";

export interface RoutingComparisonRow {
  modelKey: string;
  provider: string;
  actualTrafficShare: number;
}

interface ProviderComparison {
  provider: string;
  actualTrafficShare: number;
}

interface ModelComparison {
  modelKey: string;
  providers: ProviderComparison[];
}

interface AxisTooltipParam {
  axisValue?: string | number;
}

interface ChartLabelParam {
  value?: unknown;
}

const PROVIDER_COLORS = [
  "#2563eb",
  "#0f766e",
  "#b45309",
  "#7c3aed",
  "#be123c",
  "#0369a1",
  "#4d7c0f",
  "#6d28d9",
];

export function buildRoutingComparisonOption(
  rows: RoutingComparisonRow[],
  width: number,
): EChartsCoreOption {
  const comparisons = buildModelComparisons(rows);
  const providers = unique(rows.map((row) => row.provider));
  const compact = width < 720;

  return {
    color: PROVIDER_COLORS,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      confine: true,
      renderMode: "richText",
      formatter: (params: AxisTooltipParam[]) => formatComparisonTooltip(params, comparisons),
    },
    legend: {
      top: 0,
      type: "scroll",
      data: providers,
      itemGap: compact ? 10 : 18,
      textStyle: { fontSize: compact ? 10 : 12 },
    },
    grid: {
      top: compact ? 48 : 58,
      left: compact ? 92 : 166,
      right: compact ? 12 : 32,
      bottom: 34,
    },
    xAxis: {
      type: "value",
      min: 0,
      max: 100,
      name: "%",
      splitNumber: compact ? 2 : 5,
      axisLabel: { fontSize: compact ? 9 : 12 },
    },
    yAxis: {
      type: "category",
      data: comparisons.map((comparison) => comparison.modelKey),
      axisLabel: {
        fontSize: compact ? 9 : 12,
        formatter: compact
          ? (value: string) => value.length > 14 ? `${value.slice(0, 13)}…` : value
          : undefined,
        width: compact ? 82 : 154,
        overflow: "truncate",
      },
    },
    series: providers.map((provider) => ({
      name: provider,
      type: "bar",
      stack: "trafficShare",
      barMaxWidth: compact ? 20 : 28,
      data: comparisons.map((comparison) =>
        comparison.providers.find((item) => item.provider === provider)?.actualTrafficShare ?? 0),
      label: {
        show: !compact,
        position: "inside",
        color: "#ffffff",
        fontWeight: 600,
        textBorderColor: "rgba(15, 23, 42, 0.55)",
        textBorderWidth: 2,
        formatter: (params: ChartLabelParam) => formatActualShareLabel(params.value),
      },
      emphasis: { focus: "series" },
    })),
  };
}

function buildModelComparisons(rows: RoutingComparisonRow[]): ModelComparison[] {
  const modelKeys = unique(rows.map((row) => row.modelKey));
  return modelKeys.map((modelKey) => {
    const providerRows = rows.filter((row) => row.modelKey === modelKey);
    return {
      modelKey,
      providers: unique(providerRows.map((row) => row.provider)).map((provider) => ({
        provider,
        actualTrafficShare: sumShare(providerRows, provider),
      })),
    };
  });
}

function formatComparisonTooltip(
  params: AxisTooltipParam[],
  comparisons: ModelComparison[],
): string {
  const modelKey = String(params[0]?.axisValue ?? "");
  const comparison = comparisons.find((item) => item.modelKey === modelKey);
  if (!comparison) return "无数据";
  const actualTotal = comparison.providers.reduce(
    (sum, item) => sum + item.actualTrafficShare,
    0,
  );
  return [
    modelKey,
    ...comparison.providers.map((item) =>
      `${item.provider}  调用占比 ${formatPercent(item.actualTrafficShare)}`),
    ...(actualTotal > 0 ? [] : ["所选时间范围内暂无调用"]),
  ].join("\n");
}

function formatActualShareLabel(value: unknown): string {
  return typeof value === "number" && value >= 8 ? formatPercent(value) : "";
}

function sumShare(
  rows: RoutingComparisonRow[],
  provider: string,
): number {
  return rows
    .filter((row) => row.provider === provider)
    .reduce((sum, row) => sum + row.actualTrafficShare, 0);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
