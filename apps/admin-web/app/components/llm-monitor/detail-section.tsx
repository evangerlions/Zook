import { Alert, Empty, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";

import type { AdminLlmMetricsDocument, LlmHourlySeriesItem } from "../../lib/types";
import { LlmChart } from "./llm-chart";
import {
  buildLatencyOption,
  formatLatency,
  formatMetricNumber,
  formatPercent,
} from "./llm-monitor-view-model";

export function DetailSection({
  metrics,
  provider,
  providerModel,
}: {
  metrics: AdminLlmMetricsDocument;
  provider: string;
  providerModel: string;
}) {
  if (!provider && !providerModel) return null;
  const title = [provider || "全部 Provider", providerModel || "全部 Model", metrics.operation ?? "全部类型"]
    .join(" × ");

  return (
    <section className="surface-card llm-dashboard-section">
      <header className="card-header">
        <div>
          <h2>{title} · {metrics.range} 深度分析</h2>
          <p>顶部调用/Token 趋势已同步当前筛选；这里补充延迟分布和可排序的精确时间桶数据。</p>
        </div>
        <Tag color="blue">筛选范围</Tag>
      </header>
      {metrics.summary.requestCount === 0 ? (
        <Empty description="当前 Provider / Model 组合在所选范围没有调用数据" />
      ) : <>{metrics.operation ? (
        <LlmChart
          option={(width) => buildLatencyOption(metrics.items, width)}
          summary={`${title} 的 P50/P95 总延迟和首响应延迟趋势`}
        />
      ) : (
        <Alert message="请选择 Chat 或 Embedding 后查看延迟趋势；全部类型不会混合计算百分位。" showIcon type="info" />
      )}
      <div className="llm-table-block">
        <Table<LlmHourlySeriesItem>
          columns={detailColumns(metrics.granularity)}
          dataSource={metrics.items.filter((item) => item.available)}
          locale={{ emptyText: "当前筛选范围没有可用时间桶数据" }}
          pagination={{ pageSize: 12, hideOnSinglePage: true }}
          rowKey="bucket"
          scroll={{ x: 1560 }}
          size="small"
        />
      </div>
      </>}
    </section>
  );
}

function detailColumns(granularity: "hour" | "day"): ColumnsType<LlmHourlySeriesItem> {
  return [
    { title: granularity === "hour" ? "小时" : "日期", dataIndex: "bucket", fixed: "left", width: 150 },
    { title: "调用", dataIndex: "requestCount", width: 82, sorter: (a, b) => a.requestCount - b.requestCount, render: formatMetricNumber },
    { title: "成功", dataIndex: "successCount", width: 82, sorter: (a, b) => a.successCount - b.successCount, render: formatMetricNumber },
    { title: "失败", dataIndex: "failureCount", width: 82, sorter: (a, b) => a.failureCount - b.failureCount, render: formatMetricNumber },
    { title: "超时", dataIndex: "timeoutCount", width: 82, sorter: (a, b) => a.timeoutCount - b.timeoutCount, render: formatMetricNumber },
    { title: "取消", dataIndex: "cancelledCount", width: 82, sorter: (a, b) => a.cancelledCount - b.cancelledCount, render: formatMetricNumber },
    { title: "成功率", dataIndex: "successRate", width: 96, sorter: (a, b) => a.successRate - b.successRate, render: formatPercent },
    { title: "总 Token", dataIndex: "totalTokens", width: 112, sorter: (a, b) => (a.totalTokens ?? 0) - (b.totalTokens ?? 0), render: formatMetricNumber },
    { title: "Prompt", dataIndex: "promptTokens", width: 96, sorter: optionalNumberSorter("promptTokens"), render: formatMetricNumber },
    { title: "可见输出", dataIndex: "visibleOutputTokens", width: 100, sorter: optionalNumberSorter("visibleOutputTokens"), render: formatMetricNumber },
    { title: "Reasoning", dataIndex: "reasoningTokens", width: 100, sorter: optionalNumberSorter("reasoningTokens"), render: formatMetricNumber },
    { title: "未分类", dataIndex: "unclassifiedTokens", width: 96, sorter: optionalNumberSorter("unclassifiedTokens"), render: formatMetricNumber },
    { title: "P50 首响应", dataIndex: "p50FirstByteLatencyMs", width: 112, sorter: optionalNumberSorter("p50FirstByteLatencyMs"), render: formatLatency },
    { title: "P95 首响应", dataIndex: "p95FirstByteLatencyMs", width: 112, sorter: optionalNumberSorter("p95FirstByteLatencyMs"), render: formatLatency },
    { title: "P50 总延迟", dataIndex: "p50TotalLatencyMs", width: 112, sorter: optionalNumberSorter("p50TotalLatencyMs"), render: formatLatency },
    { title: "P95 总延迟", dataIndex: "p95TotalLatencyMs", width: 112, sorter: optionalNumberSorter("p95TotalLatencyMs"), render: formatLatency },
  ];
}

function optionalNumberSorter(
  field: "promptTokens" | "visibleOutputTokens" | "reasoningTokens" | "unclassifiedTokens" |
    "p50FirstByteLatencyMs" | "p95FirstByteLatencyMs" | "p50TotalLatencyMs" | "p95TotalLatencyMs",
) {
  return (left: LlmHourlySeriesItem, right: LlmHourlySeriesItem) =>
    (left[field] ?? -1) - (right[field] ?? -1);
}
