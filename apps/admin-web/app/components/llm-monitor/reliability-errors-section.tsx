import { Empty, Select, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";

import { formatTimestamp } from "../../lib/format";
import type {
  AdminLlmMetricsDocument,
  LlmHealthFailureMetricsGroup,
} from "../../lib/types";
import { formatMetricNumber } from "./llm-monitor-view-model";
import { ProviderBadge } from "./provider-badge";
import {
  buildTopRoutingModelOptions,
  filterHealthFailures,
} from "./reliability-errors-view-model";
import {
  compareNumbers,
  compareText,
  compareTimestamps,
} from "./table-sorting";
import { useMultiColumnSort, type MultiColumnSortController } from "./use-multi-column-sort";

export function ReliabilityErrorsSection({ metrics }: { metrics: AdminLlmMetricsDocument }) {
  const sort = useMultiColumnSort();
  const [modelKey, setModelKey] = useState("");
  const topModels = useMemo(
    () => buildTopRoutingModelOptions(metrics.routes.items),
    [metrics.routes.items],
  );
  const failures = useMemo(
    () => filterHealthFailures(metrics.healthFailures.items, modelKey),
    [metrics.healthFailures.items, modelKey],
  );

  useEffect(() => {
    if (modelKey && !topModels.some((item) => item.modelKey === modelKey)) {
      setModelKey("");
    }
  }, [modelKey, topModels]);

  return (
    <section className={`surface-card llm-dashboard-section llm-reliability-errors${metrics.healthFailures.items.length ? " has-errors" : ""}`}>
      <header className="card-header">
        <div>
          <h2>影响健康的 Top 错误</h2>
          <p>只统计进入健康成功率分母的失败和超时；客户端取消及健康中性事件不在这里。</p>
        </div>
        <div className="llm-error-filter">
          <span>按调用量 Top 5 路由 Model 筛选</span>
          <Select
            aria-label="错误表格路由 Model"
            className="llm-filter-select llm-filter-select--model"
            onChange={setModelKey}
            options={[
              { label: "全部错误", value: "" },
              ...topModels.map((item) => ({
                label: `${item.modelKey} · ${formatMetricNumber(item.requestCount)} 次调用`,
                value: item.modelKey,
              })),
            ]}
            value={modelKey}
          />
        </div>
      </header>

      {metrics.healthFailures.items.length ? (
        <Table<LlmHealthFailureMetricsGroup>
          columns={failureColumns(sort)}
          dataSource={failures}
          locale={{ emptyText: "这个 Top 5 模型在当前范围没有影响健康的错误" }}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          rowKey={(row) => [
            row.routingModelKey,
            row.provider,
            row.providerModel,
            row.operation,
            row.errorCode,
            row.errorMessage ?? "",
          ].join(":")}
          scroll={{ x: 1140 }}
          size="small"
          sortDirections={sort.sortDirections}
        />
      ) : (
        <Empty description="当前筛选范围没有影响健康成功率的失败或超时" />
      )}
      {metrics.healthFailures.truncated ? (
        <p className="llm-table-footnote">错误组合较多，当前仅展示发生次数最高的 100 组。</p>
      ) : null}
    </section>
  );
}

function failureColumns(sort: MultiColumnSortController): ColumnsType<LlmHealthFailureMetricsGroup> {
  return [
    {
      ...sort.column<LlmHealthFailureMetricsGroup>("errorCode", (left, right) => compareText(left.errorCode, right.errorCode)),
      title: "错误码",
      dataIndex: "errorCode",
      fixed: "left",
      width: 210,
      render: (value) => <Tag color="error">{value}</Tag>,
    },
    {
      ...sort.column<LlmHealthFailureMetricsGroup>("errorMessage", (left, right) => compareText(left.errorMessage, right.errorMessage)),
      title: "错误信息",
      dataIndex: "errorMessage",
      width: 360,
      render: (value) => value || <span className="llm-muted-value">历史记录未保存错误信息</span>,
    },
    {
      ...sort.column<LlmHealthFailureMetricsGroup>("count", (left, right) => compareNumbers(left.count, right.count)),
      title: "次数",
      dataIndex: "count",
      width: 88,
      render: formatMetricNumber,
    },
    {
      ...sort.column<LlmHealthFailureMetricsGroup>("routingModelKey", (left, right) => compareText(left.routingModelKey, right.routingModelKey)),
      title: "路由 Model",
      dataIndex: "routingModelKey",
      width: 180,
      ellipsis: true,
    },
    {
      ...sort.column<LlmHealthFailureMetricsGroup>("provider", (left, right) => compareText(left.provider, right.provider)),
      title: "Provider",
      dataIndex: "provider",
      width: 140,
      ellipsis: true,
      render: (value) => <ProviderBadge provider={value} />,
    },
    {
      ...sort.column<LlmHealthFailureMetricsGroup>("providerModel", (left, right) => compareText(left.providerModel, right.providerModel)),
      title: "Provider Model",
      dataIndex: "providerModel",
      width: 190,
      ellipsis: true,
    },
    {
      ...sort.column<LlmHealthFailureMetricsGroup>("operation", (left, right) => compareText(left.operation, right.operation)),
      title: "类型",
      dataIndex: "operation",
      width: 100,
      render: (value) => <Tag>{value}</Tag>,
    },
    {
      ...sort.column<LlmHealthFailureMetricsGroup>("lastOccurredAt", (left, right) => compareTimestamps(left.lastOccurredAt, right.lastOccurredAt)),
      title: "最近发生",
      dataIndex: "lastOccurredAt",
      width: 170,
      render: formatTimestamp,
    },
  ];
}
