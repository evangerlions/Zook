import { Alert, Button, Empty, Segmented, Select, Skeleton, Switch, Tag } from "antd";

import { useLlmOperationsDashboard } from "../hooks/use-llm-operations-dashboard";
import { formatTimestamp } from "../lib/format";
import type { LlmMetricsOperation, LlmMetricsRange } from "../lib/types";
import { CrossMatrixSection } from "./llm-monitor/cross-matrix-section";
import { DetailSection } from "./llm-monitor/detail-section";
import { OperationsTables } from "./llm-monitor/operations-tables";
import { OverviewSection } from "./llm-monitor/overview-section";
import { ReliabilityErrorsSection } from "./llm-monitor/reliability-errors-section";
import { RoutingSection } from "./llm-monitor/routing-section";

const RANGE_OPTIONS: LlmMetricsRange[] = ["24h", "48h", "7d", "30d"];

export function LlmMonitorTab() {
  const dashboard = useLlmOperationsDashboard();
  const metrics = dashboard.metrics;

  return (
    <div aria-busy={dashboard.loading || dashboard.refreshing} className="stack llm-dashboard">
      <section className="surface-card llm-filter-bar">
        <div className="llm-filter-controls">
          <Segmented
            className="range-segmented"
            onChange={(value) => dashboard.setRange(value as LlmMetricsRange)}
            options={RANGE_OPTIONS}
            value={dashboard.range}
          />
          <Select
            aria-label="调用类型"
            className="llm-filter-select"
            onChange={(value) => dashboard.setOperation(value as "" | LlmMetricsOperation)}
            options={[
              { label: "全部类型", value: "" },
              { label: "Chat", value: "chat" },
              { label: "Embedding", value: "embedding" },
            ]}
            value={dashboard.operation}
          />
          <Select
            aria-label="Provider"
            className="llm-filter-select"
            onChange={dashboard.setProvider}
            options={[
              { label: "全部 Provider", value: "" },
              ...dashboard.providerOptions.map((item) => ({ label: item.label, value: item.provider })),
            ]}
            showSearch
            value={dashboard.provider}
          />
          <Select
            aria-label="Provider Model"
            className="llm-filter-select llm-filter-select--model"
            onChange={dashboard.setProviderModel}
            options={[
              { label: "全部 Provider Model", value: "" },
              ...dashboard.providerModelOptions.map((model) => ({ label: model, value: model })),
            ]}
            showSearch
            value={dashboard.providerModel}
          />
        </div>
        <div className="llm-refresh-controls">
          <label className="llm-auto-refresh">
            <Switch checked={dashboard.autoRefresh} onChange={dashboard.setAutoRefresh} size="small" />
            <span>60 秒自动刷新</span>
          </label>
          <Button loading={dashboard.refreshing || dashboard.pendingFilters} onClick={() => void dashboard.refresh()}>刷新</Button>
        </div>
      </section>

      {metrics ? (
        <div className="llm-data-meta">
          <span>时区 {metrics.timezone}</span>
          <span>更新于 {formatTimestamp(metrics.generatedAt)}</span>
          <span>当前内容：{metrics.operation ?? "全部类型"} · {metrics.provider ?? "全部 Provider"} · {metrics.providerModel ?? "全部 Model"}</span>
          {metrics.dataAvailableSince ? <Tag>数据自 {formatTimestamp(metrics.dataAvailableSince)} 起可用</Tag> : null}
          {metrics.models.truncated || metrics.providerMetrics.truncated || metrics.routes.truncated || metrics.crossMetrics.truncated
            ? <Tag color="warning">高基数结果已截断</Tag>
            : null}
        </div>
      ) : null}

      {dashboard.error ? (
        <Alert
          action={<Button onClick={() => void dashboard.refresh()} size="small">重试</Button>}
          description={metrics ? "保留上次成功数据，直到刷新恢复。" : undefined}
          message={`监控数据刷新失败：${dashboard.error}`}
          showIcon
          type="error"
        />
      ) : null}

      {dashboard.filterNotice ? (
        <Alert closable message={dashboard.filterNotice} onClose={dashboard.clearFilterNotice} showIcon type="warning" />
      ) : null}

      {dashboard.pendingFilters && metrics ? (
        <Alert
          message="正在应用新筛选；下方暂时保留上一次查询结果，完成后会整体切换。"
          showIcon
          type="info"
        />
      ) : null}

      {dashboard.loading && !metrics ? (
        <DashboardSkeleton />
      ) : metrics ? (
        <>
          <OverviewSection metrics={metrics} />
          <ReliabilityErrorsSection metrics={metrics} />
          <RoutingSection metrics={metrics} />
          <OperationsTables
            metrics={metrics}
            onSelectModel={(model, operation) => {
              dashboard.setProvider("");
              dashboard.setProviderModel(model);
              dashboard.setOperation(operation);
            }}
            onSelectProvider={(provider, operation) => {
              dashboard.setProviderModel("");
              dashboard.setProvider(provider);
              dashboard.setOperation(operation);
            }}
            selectedModel={metrics.providerModel ?? ""}
            selectedProvider={metrics.provider ?? ""}
          />
          <CrossMatrixSection
            metrics={metrics}
            onSelect={dashboard.selectIntersection}
            selectedOperation={metrics.operation}
            selectedProvider={metrics.provider ?? ""}
            selectedProviderModel={metrics.providerModel ?? ""}
          />
          <DetailSection
            metrics={metrics}
            provider={metrics.provider ?? ""}
            providerModel={metrics.providerModel ?? ""}
          />
        </>
      ) : (
        <section className="surface-card"><Empty description="暂时没有可展示的 LLM 监控数据" /></section>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="stack" aria-label="正在加载 LLM 运营看板">
      <section className="surface-card"><Skeleton active paragraph={{ rows: 3 }} /></section>
      <div className="llm-chart-grid">
        <section className="surface-card llm-skeleton-chart"><Skeleton active /></section>
        <section className="surface-card llm-skeleton-chart"><Skeleton active /></section>
      </div>
    </div>
  );
}
