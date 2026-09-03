import { formatPercent, successRateTone } from "./llm-monitor-view-model";

export function SuccessRateBadge({ value }: { value?: number }) {
  const tone = successRateTone(value);
  return (
    <span className={`llm-success-rate llm-success-rate--${tone}`}>
      {formatPercent(value)}
    </span>
  );
}
