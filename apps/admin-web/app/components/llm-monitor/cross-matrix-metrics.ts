import type { LlmCrossMetricsGroup } from "../../lib/types";
import { formatLatency, formatMetricNumber, formatPercent, formatTokenNumber } from "./llm-monitor-view-model.ts";

export type MatrixMetric = "calls" | "tokens" | "success" | "p50" | "p95";

export function getCrossMatrixMetricValue(route: LlmCrossMetricsGroup, metric: MatrixMetric): number | undefined {
  switch (metric) {
    case "calls": return route.summary.requestCount;
    case "tokens": return route.summary.totalTokens;
    case "success": return route.summary.successRate;
    case "p50": return route.summary.p50TotalLatencyMs ?? 0;
    case "p95": return route.summary.p95TotalLatencyMs ?? 0;
  }
}

export function formatCrossMatrixMetricValue(value: number | undefined, metric: MatrixMetric): string {
  if (metric === "success") return formatPercent(value);
  if (metric === "p50" || metric === "p95") return formatLatency(value || undefined);
  if (metric === "tokens") return formatTokenNumber(value);
  return formatMetricNumber(value);
}
