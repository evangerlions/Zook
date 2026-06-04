import { Button, Collapse, Table, Tag } from "antd";
import { useMemo } from "react";

import { JsonPreview } from "./json-preview";
import { MetricCard } from "./metric-card";
import {
  createEmptyLlmSmokeSummary,
  toModelKindLabel,
} from "../lib/llm-config";
import { formatTimestamp } from "../lib/format";
import type {
  AdminLlmSmokeTestDocument,
  AdminLlmSmokeTestItem,
} from "../lib/types";

interface LlmSmokeTabProps {
  onRunSmokeTest: () => void;
  runningSmokeTest: boolean;
  smokeDocument: AdminLlmSmokeTestDocument | null;
}

export function LlmSmokeTab({
  onRunSmokeTest,
  runningSmokeTest,
  smokeDocument,
}: LlmSmokeTabProps) {
  const smokeSummary = smokeDocument?.summary ?? createEmptyLlmSmokeSummary();
  const smokeColumns = useMemo(
    () => [
      {
        title: "厂商",
        key: "provider",
        render: (_: unknown, item: AdminLlmSmokeTestItem) => (
          <div className="table-primary-cell table-primary-cell--stack">
            <strong>{item.providerLabel || item.provider}</strong>
            <span className="mono">{item.provider}</span>
          </div>
        ),
      },
      {
        title: "模型",
        key: "model",
        render: (_: unknown, item: AdminLlmSmokeTestItem) => (
          <div className="table-primary-cell table-primary-cell--stack">
            <strong>{item.modelLabel || item.modelKey}</strong>
            <span className="mono">{item.modelKey}</span>
          </div>
        ),
      },
      {
        title: "厂商模型",
        dataIndex: "providerModel",
        key: "providerModel",
        render: (value: string, item: AdminLlmSmokeTestItem) => (
          item.configured && value ? <span className="mono">{value}</span> : <span className="meta-text">未配置</span>
        ),
      },
      {
        title: "类型",
        dataIndex: "modelKind",
        key: "modelKind",
        render: (value: AdminLlmSmokeTestItem["modelKind"]) => toModelKindLabel(value),
      },
      {
        title: "结果",
        dataIndex: "status",
        key: "status",
        render: (value: AdminLlmSmokeTestItem["status"]) => (
          <Tag bordered={false} color={getSmokeStatusColor(value)}>{getSmokeStatusLabel(value)}</Tag>
        ),
      },
      {
        title: "耗时",
        dataIndex: "latencyMs",
        key: "latencyMs",
        align: "right" as const,
        render: (value: number | undefined, item: AdminLlmSmokeTestItem) => (
          item.status === "skipped" || value == null ? <span className="meta-text">-</span> : `${value} ms`
        ),
      },
      {
        title: "结果摘要",
        key: "message",
        render: (_: unknown, item: AdminLlmSmokeTestItem) => (
          <div className="table-primary-cell table-primary-cell--stack">
            <span>{item.message}</span>
            {item.responsePreview ? <span className="table-smoke-preview">{item.responsePreview}</span> : null}
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="stack">
      <section className="surface-card">
        <div className="card-header">
          <div>
            <h2>冒烟测试</h2>
            <p>按当前生效配置遍历厂商 × 模型矩阵，验证 provider 连通性、响应耗时和基本返回结果。</p>
          </div>
          <div className="button-row">
            <span className="meta-chip">冷却 {smokeDocument?.cooldownSeconds ?? 10}s</span>
            <span className="meta-chip">{smokeDocument ? formatTimestamp(smokeDocument.executedAt) : "尚未执行"}</span>
            <Button disabled={runningSmokeTest} loading={runningSmokeTest} onClick={onRunSmokeTest} type="primary">
              {runningSmokeTest ? "执行中..." : "运行冒烟测试"}
            </Button>
          </div>
        </div>

        <div className="metric-grid">
          <MetricCard label="总矩阵" value={String(smokeSummary.totalCount)} />
          <MetricCard label="成功" value={String(smokeSummary.successCount)} />
          <MetricCard label="失败" value={String(smokeSummary.failureCount)} />
          <MetricCard label="跳过" value={String(smokeSummary.skippedCount)} />
        </div>
      </section>

      <section className="surface-card">
        <div className="card-header">
          <div>
            <h2>执行结果</h2>
            <p>主表格展示每个厂商 × 模型的状态、耗时和结果摘要，原始返回放在下面折叠区里。</p>
          </div>
        </div>

        {smokeDocument?.items.length ? (
          <Table<AdminLlmSmokeTestItem>
            className="smoke-table"
            columns={smokeColumns}
            dataSource={smokeDocument.items}
            pagination={false}
            rowClassName={(item) => `smoke-table-row smoke-table-row--${item.status}`}
            rowKey={(item) => `${item.provider}-${item.modelKey}-${item.providerModel || "missing"}`}
            scroll={{ x: 1080 }}
          />
        ) : (
          <div className="empty-state">运行一次冒烟测试后，这里会展示完整矩阵结果。</div>
        )}
      </section>

      <section className="surface-card collapse-card">
        <Collapse
          className="config-collapse"
          defaultActiveKey={[]}
          items={[
            {
              key: "smoke-json",
              label: "原始 JSON 结构",
              children: smokeDocument ? (
                <JsonPreview value={smokeDocument} />
              ) : (
                <div className="empty-state">运行后才会生成原始冒烟测试 JSON。</div>
              ),
            },
          ]}
        />
      </section>
    </div>
  );
}

function getSmokeStatusLabel(status: AdminLlmSmokeTestItem["status"]) {
  if (status === "success") {
    return "成功";
  }

  if (status === "failed") {
    return "失败";
  }

  return "跳过";
}

function getSmokeStatusColor(status: AdminLlmSmokeTestItem["status"]) {
  if (status === "success") {
    return "success";
  }

  if (status === "failed") {
    return "error";
  }

  return "default";
}
