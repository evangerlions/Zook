import { Segmented, Select } from "antd";

import { MetricCard } from "./metric-card";
import { createEmptyLlmSummary } from "../lib/llm-config";
import { formatNumber } from "../lib/format";
import type {
  AdminLlmMetricsDocument,
  AdminLlmModelMetricsDocument,
  LlmMetricsRange,
} from "../lib/types";

const RANGE_OPTIONS: LlmMetricsRange[] = ["24h", "7d", "30d"];

interface LlmMonitorTabProps {
  loadingMetrics: boolean;
  metrics: AdminLlmMetricsDocument | null;
  modelMetrics: AdminLlmModelMetricsDocument | null;
  onRangeChange: (range: LlmMetricsRange) => void;
  onSelectModel: (modelKey: string) => void;
  range: LlmMetricsRange;
  selectedModelKey: string;
}

export function LlmMonitorTab({
  loadingMetrics,
  metrics,
  modelMetrics,
  onRangeChange,
  onSelectModel,
  range,
  selectedModelKey,
}: LlmMonitorTabProps) {
  const summary = metrics?.summary ?? createEmptyLlmSummary();

  return (
    <div className="stack">
      <section className="surface-card">
        <div className="card-header">
          <div>
            <h2>整体指标</h2>
            <p>按小时聚合的全局监控，用来快速判断当前路由稳定性。</p>
          </div>
          <Segmented
            className="range-segmented"
            onChange={(value) => onRangeChange(value as LlmMetricsRange)}
            options={RANGE_OPTIONS}
            value={range}
          />
        </div>

        {loadingMetrics ? <p className="meta-text">正在加载监控指标...</p> : null}

        <div className="metric-grid">
          <MetricCard hint="最近范围内的总请求次数" label="请求量" value={formatNumber(summary.requestCount)} />
          <MetricCard hint="成功次数 / 请求次数" label="成功率" value={`${summary.successRate}%`} />
          <MetricCard hint="从请求发出到收到首块内容" label="平均首字节" value={`${summary.avgFirstByteLatencyMs} ms`} />
          <MetricCard hint="从请求发出到完整结束" label="平均总耗时" value={`${summary.avgTotalLatencyMs} ms`} />
        </div>
      </section>

      <div className="page-grid page-grid--wide">
        <section className="surface-card">
          <div className="card-header">
            <div>
              <h2>模型对比</h2>
              <p>选择一个模型，查看它在当前时间范围内的路由表现。</p>
            </div>
            <Select
              className="inline-input"
              onChange={onSelectModel}
              options={[
                { label: "请选择模型", value: "" },
                ...((metrics?.models ?? []).map((item) => ({
                  label: item.label,
                  value: item.modelKey,
                }))),
              ]}
              value={selectedModelKey}
            />
          </div>

          {(metrics?.models ?? []).length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>模型</th>
                    <th>请求量</th>
                    <th>成功率</th>
                    <th>平均首字节</th>
                    <th>平均总耗时</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics?.models.map((item) => (
                    <tr key={item.modelKey}>
                      <td>{item.label}</td>
                      <td>{formatNumber(item.summary.requestCount)}</td>
                      <td>{item.summary.successRate}%</td>
                      <td>{item.summary.avgFirstByteLatencyMs} ms</td>
                      <td>{item.summary.avgTotalLatencyMs} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">当前范围内还没有模型调用数据。</div>
          )}
        </section>

        <aside className="panel-stack">
          <section className="side-card">
            <div className="card-header">
              <div>
                <h2>所选模型明细</h2>
                <p>按 provider / providerModel 展示 route 聚合结果。</p>
              </div>
            </div>
            {modelMetrics ? (
              <div className="stack">
                <div className="metric-grid">
                  <MetricCard label="请求量" value={formatNumber(modelMetrics.summary.requestCount)} />
                  <MetricCard label="成功率" value={`${modelMetrics.summary.successRate}%`} />
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Provider</th>
                        <th>Model</th>
                        <th>请求量</th>
                        <th>成功率</th>
                        <th>平均总耗时</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modelMetrics.routes.map((item) => (
                        <tr key={`${item.provider}-${item.providerModel}`}>
                          <td>{item.provider}</td>
                          <td className="mono">{item.providerModel}</td>
                          <td>{formatNumber(item.summary.requestCount)}</td>
                          <td>{item.summary.successRate}%</td>
                          <td>{item.summary.avgTotalLatencyMs} ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="empty-state">选择一个模型后，这里会显示 route 级别明细。</div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
