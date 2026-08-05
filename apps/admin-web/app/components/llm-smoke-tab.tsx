import { Collapse, Table, Tag } from "antd";
import { useMemo } from "react";

import { JsonPreview } from "./json-preview";
import { LlmSmokeRunner } from "./llm-smoke-runner";
import { LlmSmokeSummary } from "./llm-smoke-summary";
import { toModelKindLabel } from "../lib/llm-config";
import type {
  AdminLlmSmokeTestDocument,
  AdminLlmSmokeTestItem,
  AdminLlmSmokeTestRunRequest,
  LlmServiceConfig,
} from "../lib/types";

interface LlmSmokeTabProps {
  config: LlmServiceConfig | null;
  onRunSmokeTest: (input: AdminLlmSmokeTestRunRequest) => void;
  runningSmokeTest: boolean;
  smokeDocument: AdminLlmSmokeTestDocument | null;
}

export function LlmSmokeTab({
  config,
  onRunSmokeTest,
  runningSmokeTest,
  smokeDocument,
}: LlmSmokeTabProps) {
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
    <div className="stack llm-smoke-page">
      <section className="surface-card llm-smoke-command-card">
        <div className="llm-smoke-command-header">
          <div>
            <span className="llm-smoke-eyebrow">Connectivity check</span>
            <h2>冒烟测试</h2>
            <p>验证当前生效配置的连通性与返回质量。可以覆盖全部组合，也可以只检查一条模型路由。</p>
          </div>
          <div className="llm-smoke-command-meta">
            <span>真实请求</span>
            <span>{smokeDocument?.cooldownSeconds ?? 10}s 冷却</span>
          </div>
        </div>
        <div className="llm-smoke-workbench">
          <LlmSmokeRunner
            config={config}
            onRun={onRunSmokeTest}
            running={runningSmokeTest}
          />
          <LlmSmokeSummary document={smokeDocument} />
        </div>
      </section>

      <section className="surface-card llm-smoke-results-card">
        <div className="llm-smoke-results-header">
          <div>
            <span className="llm-smoke-eyebrow">Run output</span>
            <h2>执行结果</h2>
            <p>按 route 查看状态、耗时与返回摘要；需要排查时再展开原始诊断数据。</p>
          </div>
          {smokeDocument ? <span className="llm-smoke-result-count">{smokeDocument.items.length} 条结果</span> : null}
        </div>

        {smokeDocument?.items.length ? (
          <>
            <div className="llm-smoke-table-frame">
              <Table<AdminLlmSmokeTestItem>
                className="smoke-table"
                columns={smokeColumns}
                dataSource={smokeDocument.items}
                pagination={false}
                rowClassName={(item) => `smoke-table-row smoke-table-row--${item.status}`}
                rowKey={(item) => `${item.provider}-${item.modelKey}-${item.providerModel || "missing"}`}
                scroll={{ x: 1080 }}
              />
            </div>
            <Collapse
              className="config-collapse llm-smoke-diagnostics"
              defaultActiveKey={[]}
              items={[
                {
                  key: "smoke-json",
                  label: "查看原始诊断数据",
                  children: <JsonPreview value={smokeDocument} />,
                },
              ]}
            />
          </>
        ) : (
          <div className="llm-smoke-empty-state">
            <span className="llm-smoke-empty-index" aria-hidden="true">01</span>
            <div>
              <strong>还没有测试记录</strong>
              <p>选择上方测试范围并运行后，结果会按 route 出现在这里。</p>
            </div>
          </div>
        )}
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
