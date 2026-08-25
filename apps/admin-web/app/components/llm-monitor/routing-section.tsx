import { Alert, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { EChartsCoreOption } from "echarts/core";

import { formatTimestamp } from "../../lib/format";
import type {
  AdminLlmMetricsDocument,
  LlmModelKind,
  LlmRouteRuntimeStatus,
  LlmRoutingStrategy,
} from "../../lib/types";
import { LlmChart } from "./llm-chart";
import { formatMetricNumber, formatPercent } from "./llm-monitor-view-model";

interface RoutingRow extends LlmRouteRuntimeStatus {
  key: string;
  modelKey: string;
  operation: LlmModelKind;
  strategy: LlmRoutingStrategy;
  actualTrafficShare: number;
}

export function RoutingSection({ metrics }: { metrics: AdminLlmMetricsDocument }) {
  const rows = buildRows(metrics);
  const snapshot = metrics.runtime;

  return (
    <section className="surface-card llm-dashboard-section">
      <header className="card-header">
        <div>
          <h2>当前动态路由决策</h2>
          <p>直接展示后端 selector 使用的基础权重、健康分、动态分和归一化选择概率，前端不复算。</p>
        </div>
        <div className="llm-snapshot-meta">
          <Tag color="blue">当前快照</Tag>
          <span>{snapshot.configRevision ? `R${snapshot.configRevision}` : "未记录 revision"}</span>
          <span>配置生效 {formatTimestamp(snapshot.configUpdatedAt)}</span>
          <span>{formatTimestamp(snapshot.generatedAt)}</span>
        </div>
      </header>

      <div className="llm-formula-note">
        <code>动态分 = 基础权重 × 健康分 ÷ 100</code>
        <span>auto 按 selectionEligible route 动态分归一化；fixed 为 100/0，健康分仅观测。</span>
      </div>

      {metrics.routingConfigChangedWithinRange ? (
        <Alert
          message="所选范围内发生过路由配置变更；当前期望概率与历史实际流量仅作参考，不产生偏差告警。"
          showIcon
          type="warning"
        />
      ) : null}

      <div className="llm-routing-chart">
        <LlmChart
          height={Math.max(260, Math.min(480, metrics.runtime.models.length * 70 + 90))}
          option={(width) => buildRoutingComparisonOption(rows, width)}
          summary="每个路由 Model 的当前期望概率和当前范围实际流量占比对比"
        />
      </div>

      <Table<RoutingRow>
        columns={routingColumns()}
        dataSource={rows}
        locale={{ emptyText: "当前配置没有可展示的 route" }}
        pagination={{ pageSize: 12, hideOnSinglePage: true }}
        rowKey="key"
        scroll={{ x: 1540 }}
        size="small"
      />
    </section>
  );
}

function buildRows(metrics: AdminLlmMetricsDocument): RoutingRow[] {
  return metrics.runtime.models
    .filter((model) => metrics.operation ? model.kind === metrics.operation : true)
    .flatMap((model) => model.routes
      .filter((route) => metrics.provider ? route.provider === metrics.provider : true)
      .filter((route) => metrics.providerModel ? route.providerModel === metrics.providerModel : true)
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

function routingColumns(): ColumnsType<RoutingRow> {
  return [
    { title: "路由 Model", dataIndex: "modelKey", fixed: "left", width: 165, ellipsis: true },
    { title: "Provider", dataIndex: "provider", width: 130, ellipsis: true },
    { title: "Provider Model", dataIndex: "providerModel", width: 180, ellipsis: true },
    { title: "策略", dataIndex: "strategy", width: 78, render: (value) => <Tag>{value}</Tag> },
    {
      title: "状态",
      width: 112,
      render: (_, row) => row.selectionEligible
        ? <Tag color={row.runtimeAvailable ? "success" : "warning"}>{row.runtimeAvailable ? "可选择" : "Adapter 不可用"}</Tag>
        : <Tag>{row.ineligibleReason === "provider_disabled" ? "Provider 禁用" : "Route 禁用"}</Tag>,
    },
    { title: "基础权重", dataIndex: "configuredWeight", width: 96, render: (value) => formatMetricNumber(value) },
    { title: "健康样本", dataIndex: "sampleSize", width: 96, render: (value) => formatMetricNumber(value) },
    { title: "健康成功率", dataIndex: "successRate", width: 112, render: (value) => formatPercent(value) },
    { title: "健康分", dataIndex: "healthScore", width: 88, render: (value) => formatMetricNumber(value) },
    { title: "动态分", dataIndex: "dynamicScore", width: 88, render: (value) => formatMetricNumber(value) },
    { title: "选择概率", dataIndex: "effectiveProbability", width: 108, render: (value) => formatPercent(value) },
    { title: "范围实际", dataIndex: "actualTrafficShare", width: 102, render: (value) => formatPercent(value) },
    { title: "选择原因", dataIndex: "selectionReason", width: 160, render: (value) => selectionReasonLabel(value) },
    { title: "窗口最近错误", dataIndex: "lastErrorAt", width: 156, render: (value) => formatTimestamp(value) },
  ];
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

function buildRoutingComparisonOption(
  rows: RoutingRow[],
  width: number,
): EChartsCoreOption {
  const modelKeys = [...new Set(rows.map((row) => row.modelKey))];
  const compact = width < 520;
  const categories = modelKeys.flatMap((key) => [`${key} · 当前期望`, `${key} · 范围实际`]);
  const providers = [...new Set(rows.map((row) => row.provider))];
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, confine: true },
    legend: { top: 0, type: "scroll" },
    grid: { top: 52, left: compact ? 94 : 170, right: compact ? 12 : 28, bottom: 30 },
    xAxis: { type: "value", min: 0, max: 100, name: "%" },
    yAxis: {
      type: "category",
      data: categories,
      axisLabel: {
        fontSize: compact ? 9 : 12,
        formatter: compact ? (value: string) => value.length > 13 ? `${value.slice(0, 12)}…` : value : undefined,
        width: compact ? 84 : 158,
        overflow: "truncate",
      },
    },
    series: providers.map((provider) => ({
      name: provider,
      type: "bar",
      stack: "share",
      barMaxWidth: 18,
      data: modelKeys.flatMap((modelKey) => {
        const routeRows = rows.filter((row) => row.modelKey === modelKey && row.provider === provider);
        return [
          routeRows.reduce((sum, row) => sum + row.effectiveProbability, 0),
          routeRows.reduce((sum, row) => sum + row.actualTrafficShare, 0),
        ];
      }),
    })),
  };
}
