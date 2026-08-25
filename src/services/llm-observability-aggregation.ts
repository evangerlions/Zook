import type {
  LlmCallObservationRecord,
  LlmObservationAggregate,
} from "../infrastructure/database/llm-observability-store.ts";

export function aggregateLlmObservations(
  records: LlmCallObservationRecord[],
): LlmObservationAggregate {
  const successful = records.filter((item) => item.outcome === "success");
  const firstResponseValues = records
    .map((item) => item.firstResponseLatencyMs)
    .filter((value): value is number => value !== undefined);
  const totalLatencyValues = successful.map((item) => item.totalLatencyMs);
  const usageRecords = records.filter((item) => item.usageSource !== "missing");
  const sumOptional = (selector: (record: LlmCallObservationRecord) => number | undefined) => {
    const values = usageRecords
      .map(selector)
      .filter((value): value is number => value !== undefined);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : undefined;
  };
  const promptTokens = sumOptional((item) => item.promptTokens);
  const visibleOutputTokens = sumOptional((item) => visibleOutput(item));
  const reasoningTokens = sumOptional((item) => item.reasoningTokens);
  const totalTokens = sumOptional((item) => item.totalTokens);
  const unclassifiedTokens = sumOptional((item) => unclassified(item));

  return {
    requestCount: records.length,
    successCount: count(records, "success"),
    failureCount: count(records, "failure"),
    timeoutCount: count(records, "timeout"),
    cancelledCount: count(records, "cancelled"),
    latencySampleCount: totalLatencyValues.length,
    firstResponseSampleCount: firstResponseValues.length,
    avgFirstResponseLatencyMs: average(firstResponseValues),
    avgTotalLatencyMs: average(totalLatencyValues),
    p50FirstResponseLatencyMs: percentile(firstResponseValues, 50),
    p95FirstResponseLatencyMs: percentile(firstResponseValues, 95),
    p50TotalLatencyMs: percentile(totalLatencyValues, 50),
    p95TotalLatencyMs: percentile(totalLatencyValues, 95),
    promptTokens,
    visibleOutputTokens,
    reasoningTokens,
    unclassifiedTokens,
    totalTokens,
    providerUsageCount: records.filter((item) => item.usageSource === "provider").length,
    estimatedUsageCount: records.filter((item) => item.usageSource === "estimated").length,
    missingUsageCount: records.filter((item) => item.usageSource === "missing").length,
  };
}

function count(
  records: LlmCallObservationRecord[],
  outcome: LlmCallObservationRecord["outcome"],
): number {
  return records.filter((item) => item.outcome === outcome).length;
}

function visibleOutput(record: LlmCallObservationRecord): number | undefined {
  if (record.completionTokens === undefined) {
    return undefined;
  }
  return Math.max(record.completionTokens - (record.reasoningTokens ?? 0), 0);
}

function unclassified(record: LlmCallObservationRecord): number | undefined {
  if (record.totalTokens === undefined) {
    return undefined;
  }
  return Math.max(
    record.totalTokens -
      (record.promptTokens ?? 0) -
      (visibleOutput(record) ?? 0) -
      (record.reasoningTokens ?? 0),
    0,
  );
}

function percentile(values: number[], target: number): number | undefined {
  if (!values.length) {
    return undefined;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round(sorted[Math.max(0, Math.ceil((target / 100) * sorted.length) - 1)] ?? 0);
}

function average(values: number[]): number | undefined {
  return values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : undefined;
}
