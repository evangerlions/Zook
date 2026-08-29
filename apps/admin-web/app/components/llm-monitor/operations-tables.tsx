import { Button, Empty, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";

import type {
  AdminLlmMetricsDocument,
  LlmModelMetricsGroup,
  LlmProviderMetricsGroup,
} from "../../lib/types";
import { LlmChart } from "./llm-chart";
import {
  buildTokenRankingOption,
  formatLatency,
  formatMetricNumber,
  formatPercent,
} from "./llm-monitor-view-model";

export function OperationsTables({
  metrics,
  onSelectModel,
  onSelectProvider,
  selectedModel,
  selectedProvider,
}: {
  metrics: AdminLlmMetricsDocument;
  onSelectModel: (model: string, operation: LlmModelMetricsGroup["operation"]) => void;
  onSelectProvider: (provider: string, operation: LlmProviderMetricsGroup["operation"]) => void;
  selectedModel: string;
  selectedProvider: string;
}) {
  const models = metrics.models.items;
  const providers = metrics.providerMetrics.items;
  const totalTokens = metrics.summary.totalTokens ?? 0;

  return (
    <div className="llm-chart-grid llm-dashboard-section">
      <OperationsPanel
        chartItems={models.map((item) => ({ label: `${item.providerModel} · ${item.operation}`, summary: item.summary }))}
        description="找出 Token 成本最高的实际 Provider Model，以及消耗来自高频调用还是单次上下文过大。"
        title="Provider Model Token 排行"
      >
        <Table<LlmModelMetricsGroup>
          columns={modelColumns(totalTokens, onSelectModel, selectedModel)}
          dataSource={models}
          locale={{ emptyText: "当前筛选范围暂无 Model 调用" }}
          pagination={{ pageSize: 8, hideOnSinglePage: true }}
          rowKey={(row) => `${row.providerModel}:${row.operation}`}
          scroll={{ x: 1460 }}
          size="small"
        />
      </OperationsPanel>

      <OperationsPanel
        chartItems={providers.map((item) => ({ label: `${item.label} · ${item.operation}`, summary: item.summary }))}
        description="比较供应商承载量、Token、可靠性和长尾延迟，为容量与额度决策提供依据。"
        title="Provider 运营表现"
      >
        <Table<LlmProviderMetricsGroup>
          columns={providerColumns(totalTokens, onSelectProvider, selectedProvider)}
          dataSource={providers}
          locale={{ emptyText: "当前筛选范围暂无 Provider 调用" }}
          pagination={{ pageSize: 8, hideOnSinglePage: true }}
          rowKey={(row) => `${row.provider}:${row.operation}`}
          scroll={{ x: 1680 }}
          size="small"
        />
      </OperationsPanel>
    </div>
  );
}

function OperationsPanel({
  chartItems,
  children,
  description,
  title,
}: {
  chartItems: Parameters<typeof buildTokenRankingOption>[0];
  children: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="surface-card llm-operations-card">
      <header className="card-header compact-card-header">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      {chartItems.length ? (
        <LlmChart
          height={Math.max(250, Math.min(360, chartItems.length * 34 + 84))}
          option={buildTokenRankingOption(chartItems)}
          summary={`${title}，展示 Prompt、可见输出、Reasoning 和未分类 Token`}
        />
      ) : <Empty description="当前筛选范围暂无可绘制数据" />}
      <div className="llm-table-block">{children}</div>
    </section>
  );
}

function modelColumns(
  totalTokens: number,
  onSelect: (model: string, operation: LlmModelMetricsGroup["operation"]) => void,
  selectedModel: string,
): ColumnsType<LlmModelMetricsGroup> {
  return [
    { title: "Provider Model", dataIndex: "providerModel", fixed: "left", width: 190, ellipsis: true, render: (value, row) => <Button aria-pressed={selectedModel === value} onClick={() => onSelect(value, row.operation)} type="link">{value}</Button> },
    { title: "类型", dataIndex: "operation", width: 92, render: (value) => <Tag>{value}</Tag> },
    { title: "调用", width: 88, sorter: (a, b) => a.summary.requestCount - b.summary.requestCount, render: (_, row) => formatMetricNumber(row.summary.requestCount) },
    { title: "总 Token", width: 116, sorter: (a, b) => (a.summary.totalTokens ?? 0) - (b.summary.totalTokens ?? 0), render: (_, row) => formatMetricNumber(row.summary.totalTokens) },
    { title: "Prompt", width: 104, render: (_, row) => formatMetricNumber(row.summary.promptTokens) },
    { title: "可见输出", width: 104, render: (_, row) => formatMetricNumber(row.summary.visibleOutputTokens) },
    { title: "Reasoning", width: 104, render: (_, row) => formatMetricNumber(row.summary.reasoningTokens) },
    { title: "未分类", width: 96, render: (_, row) => formatMetricNumber(row.summary.unclassifiedTokens) },
    { title: "单次 Token", width: 108, render: (_, row) => formatMetricNumber(row.summary.requestCount ? Math.round((row.summary.totalTokens ?? 0) / row.summary.requestCount) : undefined) },
    { title: "占比", width: 92, render: (_, row) => formatPercent(totalTokens ? ((row.summary.totalTokens ?? 0) / totalTokens) * 100 : 0) },
    { title: "成功率", width: 96, render: (_, row) => formatPercent(row.summary.successRate) },
    { title: "P50", width: 96, render: (_, row) => formatLatency(row.summary.p50TotalLatencyMs) },
    { title: "P95", width: 96, render: (_, row) => formatLatency(row.summary.p95TotalLatencyMs) },
  ];
}

function providerColumns(
  totalTokens: number,
  onSelect: (provider: string, operation: LlmProviderMetricsGroup["operation"]) => void,
  selectedProvider: string,
): ColumnsType<LlmProviderMetricsGroup> {
  return [
    { title: "Provider", dataIndex: "label", fixed: "left", width: 180, ellipsis: true, render: (value, row) => <Button aria-pressed={selectedProvider === row.provider} onClick={() => onSelect(row.provider, row.operation)} type="link">{value}</Button> },
    { title: "类型", dataIndex: "operation", width: 92, render: (value) => <Tag>{value}</Tag> },
    { title: "调用", width: 88, sorter: (a, b) => a.summary.requestCount - b.summary.requestCount, render: (_, row) => formatMetricNumber(row.summary.requestCount) },
    { title: "成功率", width: 96, render: (_, row) => formatPercent(row.summary.successRate) },
    { title: "总 Token", width: 116, sorter: (a, b) => (a.summary.totalTokens ?? 0) - (b.summary.totalTokens ?? 0), render: (_, row) => formatMetricNumber(row.summary.totalTokens) },
    { title: "Prompt", width: 104, render: (_, row) => formatMetricNumber(row.summary.promptTokens) },
    { title: "可见输出", width: 104, render: (_, row) => formatMetricNumber(row.summary.visibleOutputTokens) },
    { title: "Reasoning", width: 104, render: (_, row) => formatMetricNumber(row.summary.reasoningTokens) },
    { title: "未分类", width: 96, render: (_, row) => formatMetricNumber(row.summary.unclassifiedTokens) },
    { title: "单次 Token", width: 108, render: (_, row) => formatMetricNumber(row.summary.requestCount ? Math.round((row.summary.totalTokens ?? 0) / row.summary.requestCount) : undefined) },
    { title: "Token 占比", width: 108, render: (_, row) => formatPercent(totalTokens ? ((row.summary.totalTokens ?? 0) / totalTokens) * 100 : 0) },
    { title: "流量占比", dataIndex: "trafficShare", width: 104, render: formatPercent },
    { title: "P50 首响应", width: 118, render: (_, row) => formatLatency(row.summary.p50FirstByteLatencyMs) },
    { title: "首响应覆盖", width: 112, render: (_, row) => `${row.summary.firstResponseSampleCount}/${row.summary.requestCount}` },
    { title: "P50 总延迟", width: 112, render: (_, row) => formatLatency(row.summary.p50TotalLatencyMs) },
    { title: "P95 总延迟", width: 112, render: (_, row) => formatLatency(row.summary.p95TotalLatencyMs) },
  ];
}
