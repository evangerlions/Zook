import { Button, Popconfirm, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";

import { formatTimestamp } from "../../lib/format";
import type {
  AdminLlmMetricsDocument,
  LlmModelKind,
  LlmRouteRuntimeStatus,
  LlmRoutingStrategy,
} from "../../lib/types";
import { LlmChart } from "./llm-chart";
import { formatMetricNumber, formatPercent } from "./llm-monitor-view-model";
import { SuccessRateBadge } from "./success-rate-badge";
import { ProviderBadge } from "./provider-badge";
import {
  buildRoutingComparisonOption,
  type RoutingComparisonRow,
} from "./routing-comparison-view-model";
import {
  compareNumbers,
  compareText,
  compareTimestamps,
} from "./table-sorting";
import { useMultiColumnSort, type MultiColumnSortController } from "./use-multi-column-sort";

interface RoutingRow extends LlmRouteRuntimeStatus {
  key: string;
  modelKey: string;
  operation: LlmModelKind;
  strategy: LlmRoutingStrategy;
  actualTrafficShare: number;
}

export function RoutingSection({
  metrics,
  onResetCircuit,
  resettingCircuitKey,
}: {
  metrics: AdminLlmMetricsDocument;
  onResetCircuit: (row: RoutingRow) => Promise<void>;
  resettingCircuitKey?: string;
}) {
  const sort = useMultiColumnSort();
  const allRows = buildRows(metrics);
  const rows = filterRows(allRows, metrics);
  const visibleModelKeys = new Set(rows.map((row) => row.modelKey));
  const chartRows = allRows
    .filter((row) => visibleModelKeys.has(row.modelKey))
    .map(toComparisonRow);
  const snapshot = metrics.runtime;

  return (
    <section className="surface-card llm-dashboard-section">
      <header className="card-header">
        <div>
          <h2>当前动态路由决策</h2>
          <p>先看各路由的健康成功率和调用占比；当前路由规则保留在下方表格。</p>
        </div>
        <div className="llm-snapshot-meta">
          <Tag color="blue">当前快照</Tag>
          <span>{snapshot.configRevision ? `R${snapshot.configRevision}` : "未记录 revision"}</span>
          <span>配置生效 {formatTimestamp(snapshot.configUpdatedAt)}</span>
          <span>{formatTimestamp(snapshot.generatedAt)}</span>
        </div>
      </header>

      <div className="llm-routing-chart">
        <div className="llm-routing-chart-heading">
          <strong>调用占比</strong>
          <span>{metrics.range} 内每个模型的实际调用分布；一个模型只显示一行。</span>
        </div>
        <LlmChart
          height={Math.max(260, Math.min(440, visibleModelKeys.size * 48 + 110))}
          option={(width) => buildRoutingComparisonOption(chartRows, width)}
          summary={`${metrics.range} 内每个路由模型的调用占比，每个模型一行`}
        />
      </div>

      <Table<RoutingRow>
        columns={routingColumns(onResetCircuit, sort, resettingCircuitKey)}
        dataSource={rows}
        locale={{ emptyText: "当前配置没有可展示的 route" }}
        pagination={{ pageSize: 12, hideOnSinglePage: true }}
        rowKey="key"
        scroll={{ x: 1760 }}
        size="small"
        sortDirections={sort.sortDirections}
      />

      <div className="llm-formula-note llm-formula-note--secondary">
        <code>当前目标：基础权重 × 健康分，再在同一 Model 内归一化</code>
        <span>auto 使用健康分；fixed 直接按 100% / 0% 选择，健康分仅用于观察。</span>
      </div>
    </section>
  );
}

function buildRows(metrics: AdminLlmMetricsDocument): RoutingRow[] {
  return metrics.runtime.models
    .filter((model) => metrics.operation ? model.kind === metrics.operation : true)
    .flatMap((model) => model.routes
      .map((route) => {
    const actual = metrics.routes.items.find((item) =>
      item.routingModelKey === model.key &&
      item.provider === route.provider &&
      item.providerModel === route.providerModel &&
      item.operation === model.kind,
    );
    return {
      ...route,
      key: `${model.key}:${route.provider}:${route.providerModel}:${model.kind}`,
      modelKey: model.key,
      operation: model.kind,
      strategy: model.strategy,
      actualTrafficShare: actual?.actualTrafficShare ?? 0,
    };
      }));
}

function filterRows(
  rows: RoutingRow[],
  metrics: AdminLlmMetricsDocument,
): RoutingRow[] {
  return rows
    .filter((row) => metrics.provider ? row.provider === metrics.provider : true)
    .filter((row) => metrics.providerModel ? row.providerModel === metrics.providerModel : true);
}

function toComparisonRow(row: RoutingRow): RoutingComparisonRow {
  return {
    modelKey: row.modelKey,
    provider: row.provider,
    actualTrafficShare: row.actualTrafficShare,
  };
}

function routingColumns(
  onResetCircuit: (row: RoutingRow) => Promise<void>,
  sort: MultiColumnSortController,
  resettingCircuitKey?: string,
): ColumnsType<RoutingRow> {
  return [
    {
      ...sort.column<RoutingRow>("modelKey", (left, right) => compareText(left.modelKey, right.modelKey)),
      title: "路由 Model",
      dataIndex: "modelKey",
      fixed: "left",
      width: 165,
      ellipsis: true,
    },
    {
      ...sort.column<RoutingRow>("provider", (left, right) => compareText(left.provider, right.provider)),
      title: "Provider",
      dataIndex: "provider",
      width: 130,
      ellipsis: true,
      render: (value) => <ProviderBadge provider={value} />,
    },
    {
      ...sort.column<RoutingRow>("providerModel", (left, right) => compareText(left.providerModel, right.providerModel)),
      title: "Provider Model",
      dataIndex: "providerModel",
      width: 180,
      ellipsis: true,
    },
    {
      ...sort.column<RoutingRow>("strategy", (left, right) => compareText(left.strategy, right.strategy)),
      title: "策略",
      dataIndex: "strategy",
      width: 78,
      render: (value) => <Tag>{value}</Tag>,
    },
    {
      ...sort.column<RoutingRow>("status", (left, right) => compareText(routeStatusLabel(left), routeStatusLabel(right))),
      title: "状态",
      width: 112,
      render: (_, row) => <Tag
        color={row.circuit?.state === "open"
          ? "error"
          : row.circuit?.state === "confirming"
            ? "processing"
            : row.selectionEligible
              ? row.runtimeAvailable ? "success" : "warning"
              : undefined}
      >{routeStatusLabel(row)}</Tag>,
    },
    {
      ...sort.column<RoutingRow>("circuitRecovery", compareCircuitRecovery),
      title: "熔断恢复",
      width: 190,
      render: (_, row) => <span>{circuitRecoveryLabel(row)}</span>,
    },
    {
      ...sort.column<RoutingRow>("nextRecoveryAt", (left, right) => compareTimestamps(
        left.circuit?.nextRecoveryAt,
        right.circuit?.nextRecoveryAt,
      )),
      title: "下次探测",
      dataIndex: ["circuit", "nextRecoveryAt"],
      width: 156,
      render: (_, row) => formatTimestamp(row.circuit?.nextRecoveryAt),
    },
    {
      title: "操作",
      width: 108,
      render: (_, row) => row.circuit?.state === "open" || row.circuit?.state === "confirming"
        ? (
          <Popconfirm
            cancelText="保留"
            description="会立即清除该 route 的确认或熔断状态，重新参与正常路由。"
            okText="解除"
            onConfirm={() => onResetCircuit(row)}
            title="解除该 route 的熔断？"
          >
            <Button danger loading={resettingCircuitKey === row.key} size="small">解除熔断</Button>
          </Popconfirm>
        )
        : "—",
    },
    {
      ...sort.column<RoutingRow>("successRate", (left, right) => compareNumbers(left.successRate, right.successRate)),
      title: "健康成功率",
      dataIndex: "successRate",
      width: 118,
      render: (value) => <SuccessRateBadge value={value} />,
    },
    {
      ...sort.column<RoutingRow>("sampleSize", (left, right) => compareNumbers(left.sampleSize, right.sampleSize)),
      title: "健康样本",
      dataIndex: "sampleSize",
      width: 96,
      render: (value) => formatMetricNumber(value),
    },
    {
      ...sort.column<RoutingRow>("configuredWeight", (left, right) => compareNumbers(left.configuredWeight, right.configuredWeight)),
      title: "基础权重",
      dataIndex: "configuredWeight",
      width: 96,
      render: (value) => formatMetricNumber(value),
    },
    {
      ...sort.column<RoutingRow>("healthScore", (left, right) => compareNumbers(left.healthScore, right.healthScore)),
      title: "健康分",
      dataIndex: "healthScore",
      width: 88,
      render: (value) => formatMetricNumber(value),
    },
    {
      ...sort.column<RoutingRow>("dynamicScore", (left, right) => compareNumbers(left.dynamicScore, right.dynamicScore)),
      title: "动态分",
      dataIndex: "dynamicScore",
      width: 88,
      render: (value) => formatMetricNumber(value),
    },
    {
      ...sort.column<RoutingRow>("effectiveProbability", (left, right) => compareNumbers(left.effectiveProbability, right.effectiveProbability)),
      title: "当前目标占比",
      dataIndex: "effectiveProbability",
      width: 126,
      render: (value) => formatPercent(value),
    },
    {
      ...sort.column<RoutingRow>("actualTrafficShare", (left, right) => compareNumbers(left.actualTrafficShare, right.actualTrafficShare)),
      title: "调用占比",
      dataIndex: "actualTrafficShare",
      width: 104,
      render: (value) => formatPercent(value),
    },
    {
      ...sort.column<RoutingRow>("selectionReason", (left, right) => compareText(
        selectionReasonLabel(left.selectionReason),
        selectionReasonLabel(right.selectionReason),
      )),
      title: "选择原因",
      dataIndex: "selectionReason",
      width: 160,
      render: (value) => selectionReasonLabel(value),
    },
    {
      ...sort.column<RoutingRow>("lastErrorAt", (left, right) => compareTimestamps(left.lastErrorAt, right.lastErrorAt)),
      title: "窗口最近错误",
      dataIndex: "lastErrorAt",
      width: 156,
      render: (value) => formatTimestamp(value),
    },
  ];
}

function circuitRecoveryLabel(row: RoutingRow): string {
  if (!row.circuit?.enabled) return "未启用";
  if (row.circuit.state === "confirming") return "后台两次确认中";
  if (row.circuit.state !== "open") return "正常";
  return `失败 ${row.circuit.failureCount} · 用户 ${row.circuit.distinctUserCount} · 探测 ${row.circuit.recoverySuccessCount}/2`;
}

function compareCircuitRecovery(left: RoutingRow, right: RoutingRow): number {
  const statusComparison = compareText(circuitRecoveryLabel(left), circuitRecoveryLabel(right));
  if (statusComparison !== 0) return statusComparison;
  return compareNumbers(left.circuit?.failureCount, right.circuit?.failureCount) ||
    compareNumbers(left.circuit?.distinctUserCount, right.circuit?.distinctUserCount) ||
    compareNumbers(left.circuit?.recoverySuccessCount, right.circuit?.recoverySuccessCount);
}

function routeStatusLabel(row: RoutingRow): string {
  if (row.circuit?.state === "open") return "熔断中";
  if (row.circuit?.state === "confirming") return "确认中";
  if (row.selectionEligible) return row.runtimeAvailable ? "可选择" : "Adapter 不可用";
  return row.ineligibleReason === "provider_disabled"
    ? "Provider 禁用"
    : row.ineligibleReason === "runtime_unavailable"
      ? "Adapter 不可用"
      : "Route 禁用";
}

function selectionReasonLabel(value: RoutingRow["selectionReason"]): string {
  return ({
    health_weighted: "健康分动态加权",
    static_weight_fallback: "健康全零，回退权重",
    fixed_highest_weight: "fixed 最高权重",
    compatibility_fallback: "首条 route 兼容回退",
    not_selected: "fixed 未选中",
    ineligible: "不可选择",
  })[value];
}
