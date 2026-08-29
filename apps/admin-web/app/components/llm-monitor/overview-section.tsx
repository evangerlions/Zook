import { Empty } from "antd";
import { MetricCard } from "../metric-card";
import type { AdminLlmMetricsDocument } from "../../lib/types";
import { LlmChart } from "./llm-chart";
import {
  buildCallsOption,
  buildTokenOption,
  formatLatency,
  formatMetricNumber,
  formatPercent,
  tokenCoverage,
} from "./llm-monitor-view-model";

export function OverviewSection({ metrics }: { metrics: AdminLlmMetricsDocument }) {
  const summary = metrics.summary;
  const chat = metrics.latencyByOperation.chat;
  const embedding = metrics.latencyByOperation.embedding;
  const allOperations = !metrics.operation;
  const totalLatencyValue = allOperations
    ? `Chat ${formatLatency(chat?.p50TotalLatencyMs)} · Emb ${formatLatency(embedding?.p50TotalLatencyMs)}`
    : formatLatency(summary.p50TotalLatencyMs);
  const p95LatencyValue = allOperations
    ? `Chat ${formatLatency(chat?.p95TotalLatencyMs)} · Emb ${formatLatency(embedding?.p95TotalLatencyMs)}`
    : formatLatency(summary.p95TotalLatencyMs);

  return (
    <div className="stack llm-dashboard-section">
      <section className="surface-card">
        <header className="card-header compact-card-header">
          <div>
            <h2>{metrics.range} 运营总览</h2>
            <p>第一眼判断调用规模、Token 消耗、可靠性和典型/长尾等待时间。</p>
          </div>
        </header>
        <div className="metric-grid llm-kpi-grid">
          <MetricCard
            hint={`成功 ${summary.successCount} · 失败 ${summary.failureCount} · 超时 ${summary.timeoutCount} · 取消 ${summary.cancelledCount}`}
            label="上游调用次数"
            value={formatMetricNumber(summary.requestCount)}
          />
          <MetricCard
            hint={tokenCoverage(summary)}
            label="总 Token 消耗"
            value={formatMetricNumber(summary.totalTokens)}
          />
          <MetricCard
            hint="成功 ÷（成功 + 失败 + 超时），客户端取消不进入分母"
            label="可靠性成功率"
            value={formatPercent(summary.successRate)}
          />
          <MetricCard
            hint={`仅 Streaming Chat · ${summary.firstResponseSampleCount} 个样本`}
            label="P50 首响应"
            value={formatLatency(chat?.p50FirstByteLatencyMs ?? summary.p50FirstByteLatencyMs)}
          />
          <MetricCard
            hint="全部类型筛选时分别展示 Chat 与 Embedding"
            label="P50 总延迟"
            value={totalLatencyValue}
          />
          <MetricCard
            hint="最慢 5% 成功调用的边界"
            label="P95 总延迟"
            value={p95LatencyValue}
          />
        </div>
      </section>

      {summary.requestCount > 0 ? <div className="llm-chart-grid">
        <section className="surface-card llm-chart-card">
          <header className="card-header compact-card-header">
            <div>
              <h2>调用量与可靠性</h2>
              <p>判断流量变化是否伴随失败或超时增加。</p>
            </div>
          </header>
          <LlmChart
            option={(width) => buildCallsOption(metrics.items, width)}
            summary={`${metrics.range} 调用次数柱状图和可靠性成功率折线图`}
          />
        </section>
        <section className="surface-card llm-chart-card">
          <header className="card-header compact-card-header">
            <div>
              <h2>Token 结构趋势</h2>
              <p>识别增长来自 Prompt、可见输出、Reasoning 还是未分类差额。</p>
            </div>
          </header>
          <LlmChart
            option={(width) => buildTokenOption(metrics.items, width)}
            summary={`${metrics.range} Prompt、可见输出、Reasoning 和未分类 Token 堆叠趋势`}
          />
        </section>
      </div> : (
        <section className="surface-card"><Empty description="当前筛选范围没有调用数据；路由快照仍可在下方查看。" /></section>
      )}
    </div>
  );
}
