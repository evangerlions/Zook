import type { AdminLlmSmokeTestDocument } from "../lib/types";
import { formatTimestamp } from "../lib/format";
import { createLlmSmokeSummaryPresentation } from "../lib/llm-smoke-presentation";

interface LlmSmokeSummaryProps {
  document: AdminLlmSmokeTestDocument | null;
}

export function LlmSmokeSummary({ document }: LlmSmokeSummaryProps) {
  if (!document) {
    return (
      <aside className="llm-smoke-summary llm-smoke-summary--empty" aria-label="最近一次冒烟测试">
        <div className="llm-smoke-summary-heading">
          <span>最近一次</span>
          <span className="llm-smoke-state-dot" aria-hidden="true" />
        </div>
        <div className="llm-smoke-summary-empty-copy">
          <strong>等待首次执行</strong>
          <p>完成测试后，这里会汇总范围、状态和执行时间。</p>
        </div>
        <div className="llm-smoke-summary-placeholder" aria-hidden="true">
          <span>请求范围</span>
          <span>状态分布</span>
          <span>完成时间</span>
        </div>
      </aside>
    );
  }

  const { summary } = document;
  const presentation = createLlmSmokeSummaryPresentation(document);

  return (
    <aside className="llm-smoke-summary" aria-label="最近一次冒烟测试">
      <div className="llm-smoke-summary-heading">
        <span>最近一次</span>
        <span className={`llm-smoke-status llm-smoke-status--${presentation.statusTone}`}>
          {presentation.statusLabel}
        </span>
      </div>
      <div className="llm-smoke-summary-scope">
        <strong>{presentation.scope}</strong>
        <span>{formatTimestamp(document.executedAt)}</span>
      </div>
      <dl className="llm-smoke-summary-grid">
        <div>
          <dt>项目</dt>
          <dd>{summary.totalCount}</dd>
        </div>
        <div>
          <dt>成功</dt>
          <dd>{summary.successCount}</dd>
        </div>
        <div>
          <dt>失败</dt>
          <dd>{summary.failureCount}</dd>
        </div>
      </dl>
    </aside>
  );
}
