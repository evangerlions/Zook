import { Button, Segmented, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { EChartsCoreOption } from "echarts/core";
import { useMemo, useState } from "react";

import type {
  AdminLlmMetricsDocument,
  LlmCrossMetricsGroup,
  LlmMetricsOperation,
} from "../../lib/types";
import { LlmChart } from "./llm-chart";
import { formatLatency, formatMetricNumber, formatPercent } from "./llm-monitor-view-model";

type MatrixMetric = "calls" | "tokens" | "success" | "p50" | "p95";

const METRICS: Array<{ label: string; value: MatrixMetric }> = [
  { label: "调用次数", value: "calls" },
  { label: "总 Token", value: "tokens" },
  { label: "成功率", value: "success" },
  { label: "P50 总延迟", value: "p50" },
  { label: "P95 总延迟", value: "p95" },
];

export function CrossMatrixSection({
  metrics,
  onSelect,
  selectedOperation,
  selectedProvider,
  selectedProviderModel,
}: {
  metrics: AdminLlmMetricsDocument;
  onSelect: (provider: string, providerModel: string, operation: LlmMetricsOperation) => void;
  selectedOperation?: LlmMetricsOperation;
  selectedProvider: string;
  selectedProviderModel: string;
}) {
  const [metric, setMetric] = useState<MatrixMetric>("calls");
  const matrix = useMemo(() => buildMatrix(metrics.crossMetrics.items), [metrics.crossMetrics.items]);
  const option = useMemo(() => buildHeatmapOption(matrix, metric), [matrix, metric]);

  return (
    <section className="surface-card llm-dashboard-section">
      <header className="card-header">
        <div>
          <h2>Provider × Provider Model 交叉矩阵</h2>
          <p>快速发现同一模型在不同 Provider 的调用量、Token、可靠性和长尾延迟差异；点击单元格进入深度分析。</p>
        </div>
        <Segmented
          onChange={(value) => setMetric(value as MatrixMetric)}
          options={METRICS}
          value={metric}
        />
      </header>

      {matrix.rows.length && matrix.models.length ? (
        <>
          <div className="llm-matrix-chart-scroll">
            <LlmChart
              height={Math.max(260, Math.min(520, matrix.rows.length * 42 + 110))}
              minWidth={Math.max(640, matrix.models.length * 120 + 160)}
              onClick={(params) => {
                const selection = parseHeatmapSelection(params);
                if (selection) onSelect(selection.provider, selection.model, selection.operation);
              }}
              option={option}
              summary={`Provider 与 Provider Model 的${METRICS.find((item) => item.value === metric)?.label}热力矩阵`}
            />
          </div>
          <div className="llm-table-block">
            <Table<MatrixTableRow>
              columns={matrixColumns(matrix.models, metric, onSelect, {
                operation: selectedOperation,
                provider: selectedProvider,
                providerModel: selectedProviderModel,
              })}
              dataSource={matrix.tableRows}
              pagination={false}
              rowKey="key"
              scroll={{ x: Math.max(760, matrix.models.length * 144 + 190), y: 420 }}
              size="small"
            />
          </div>
        </>
      ) : (
        <div className="empty-state compact-empty-state">当前筛选范围没有 Provider × Model 数据。</div>
      )}
    </section>
  );
}

interface MatrixTableRow {
  key: string;
  provider: string;
  operation: LlmMetricsOperation;
  values: Map<string, LlmCrossMetricsGroup>;
}

function buildMatrix(routes: LlmCrossMetricsGroup[]) {
  const models = [...new Set(routes.map((route) => route.providerModel))].sort();
  const rowKeys = [...new Set(routes.map((route) => `${route.provider}\u0000${route.operation}`))].sort();
  const rows = rowKeys.map((key) => {
    const [provider, operation] = key.split("\u0000") as [string, LlmMetricsOperation];
    return { provider, operation };
  });
  const tableRows: MatrixTableRow[] = rows.map((row) => ({
    key: `${row.provider}:${row.operation}`,
    ...row,
    values: new Map(routes
      .filter((route) => route.provider === row.provider && route.operation === row.operation)
      .map((route) => [route.providerModel, route])),
  }));
  return { models, rows, routes, tableRows };
}

function buildHeatmapOption(
  matrix: ReturnType<typeof buildMatrix>,
  metric: MatrixMetric,
): EChartsCoreOption {
  const values = matrix.routes.map((route) => metricValue(route, metric));
  const max = Math.max(1, ...values);
  const data = matrix.routes.map((route) => [
    matrix.models.indexOf(route.providerModel),
    matrix.rows.findIndex((row) => row.provider === route.provider && row.operation === route.operation),
    metricValue(route, metric),
    route.provider,
    route.providerModel,
    route.operation,
  ]);
  return {
    tooltip: {
      confine: true,
      formatter: (params: { data?: unknown[] }) => {
        const item = params.data ?? [];
        return `${item[3]} · ${item[4]} · ${item[5]}<br/>${formatMetricValue(Number(item[2] ?? 0), metric)}`;
      },
    },
    grid: { top: 34, left: 150, right: 30, bottom: 86 },
    xAxis: {
      type: "category",
      data: matrix.models,
      splitArea: { show: true },
      axisLabel: { width: 130, overflow: "truncate", rotate: matrix.models.length > 5 ? 24 : 0 },
    },
    yAxis: {
      type: "category",
      data: matrix.rows.map((row) => `${row.provider} · ${row.operation}`),
      splitArea: { show: true },
      axisLabel: { width: 138, overflow: "truncate" },
    },
    visualMap: {
      min: 0,
      max,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 4,
      inRange: { color: ["#eff6ff", "#93c5fd", "#2563eb", "#1e3a8a"] },
    },
    series: [{
      name: "交叉指标",
      type: "heatmap",
      data,
      label: { show: true, formatter: (params: { value?: unknown[] }) => formatMetricValue(Number(params.value?.[2] ?? 0), metric) },
      emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(15, 23, 42, 0.28)" } },
    }],
  };
}

function matrixColumns(
  models: string[],
  metric: MatrixMetric,
  onSelect: (provider: string, providerModel: string, operation: LlmMetricsOperation) => void,
  selected: { operation?: LlmMetricsOperation; provider: string; providerModel: string },
): ColumnsType<MatrixTableRow> {
  return [
    {
      title: "Provider / 类型",
      key: "identity",
      fixed: "left",
      width: 180,
      render: (_, row) => <strong>{row.provider} · {row.operation}</strong>,
    },
    ...models.map((model) => ({
      title: model,
      key: model,
      width: 144,
      ellipsis: true,
      render: (_: unknown, row: MatrixTableRow) => {
        const route = row.values.get(model);
        if (!route) return "—";
        const value = metricValue(route, metric);
        return (
          <Button
            aria-label={`${row.provider} ${model} ${row.operation} ${formatMetricValue(value, metric)}`}
            aria-pressed={selected.provider === row.provider && selected.providerModel === model && selected.operation === row.operation}
            onClick={() => onSelect(row.provider, model, row.operation)}
            type="link"
          >
            {formatMetricValue(value, metric)}
          </Button>
        );
      },
    })),
  ];
}

function metricValue(route: LlmCrossMetricsGroup, metric: MatrixMetric): number {
  switch (metric) {
    case "calls": return route.summary.requestCount;
    case "tokens": return route.summary.totalTokens ?? 0;
    case "success": return route.summary.successRate;
    case "p50": return route.summary.p50TotalLatencyMs ?? 0;
    case "p95": return route.summary.p95TotalLatencyMs ?? 0;
  }
}

function formatMetricValue(value: number, metric: MatrixMetric): string {
  if (metric === "success") return formatPercent(value);
  if (metric === "p50" || metric === "p95") return formatLatency(value || undefined);
  return formatMetricNumber(value);
}

function parseHeatmapSelection(params: unknown): {
  provider: string;
  model: string;
  operation: LlmMetricsOperation;
} | undefined {
  if (!params || typeof params !== "object") return undefined;
  const data = (params as { data?: unknown }).data;
  if (!Array.isArray(data)) return undefined;
  if (typeof data[3] !== "string" || typeof data[4] !== "string") return undefined;
  if (data[5] !== "chat" && data[5] !== "embedding") return undefined;
  return { provider: data[3], model: data[4], operation: data[5] };
}
