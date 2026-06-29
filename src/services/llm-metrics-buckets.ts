import type {
  LlmHourlySeriesItem,
  LlmMetricsSummary,
} from "../shared/types.ts";

export interface LlmMetricBucket {
  hour: string;
  requestCount: number;
  successCount: number;
  failureCount: number;
  firstByteLatencySumMs: number;
  totalLatencySumMs: number;
  firstByteLatencyMaxMs: number;
  totalLatencyMaxMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  firstByteLatencyDigest: number[];
  totalLatencyDigest: number[];
}

export function createEmptyMetricBucket(hour: string): LlmMetricBucket {
  return {
    hour,
    requestCount: 0,
    successCount: 0,
    failureCount: 0,
    firstByteLatencySumMs: 0,
    totalLatencySumMs: 0,
    firstByteLatencyMaxMs: 0,
    totalLatencyMaxMs: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    firstByteLatencyDigest: [],
    totalLatencyDigest: [],
  };
}

export function mergeMetricBuckets(left: LlmMetricBucket, right: LlmMetricBucket): LlmMetricBucket {
  return {
    hour: left.hour,
    requestCount: left.requestCount + right.requestCount,
    successCount: left.successCount + right.successCount,
    failureCount: left.failureCount + right.failureCount,
    firstByteLatencySumMs: left.firstByteLatencySumMs + right.firstByteLatencySumMs,
    totalLatencySumMs: left.totalLatencySumMs + right.totalLatencySumMs,
    firstByteLatencyMaxMs: Math.max(left.firstByteLatencyMaxMs, right.firstByteLatencyMaxMs),
    totalLatencyMaxMs: Math.max(left.totalLatencyMaxMs, right.totalLatencyMaxMs),
    promptTokens: left.promptTokens + right.promptTokens,
    completionTokens: left.completionTokens + right.completionTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    firstByteLatencyDigest: [...left.firstByteLatencyDigest, ...right.firstByteLatencyDigest],
    totalLatencyDigest: [...left.totalLatencyDigest, ...right.totalLatencyDigest],
  };
}

export function toHourlySeriesItem(bucket: LlmMetricBucket): LlmHourlySeriesItem {
  return {
    hour: bucket.hour,
    ...toMetricSummary(bucket),
  };
}

export function toMetricSummary(bucket: LlmMetricBucket): LlmMetricsSummary {
  return {
    requestCount: bucket.requestCount,
    successCount: bucket.successCount,
    failureCount: bucket.failureCount,
    successRate: bucket.requestCount ? roundTwo((bucket.successCount / bucket.requestCount) * 100) : 100,
    avgFirstByteLatencyMs: bucket.requestCount ? Math.round(bucket.firstByteLatencySumMs / bucket.requestCount) : 0,
    avgTotalLatencyMs: bucket.requestCount ? Math.round(bucket.totalLatencySumMs / bucket.requestCount) : 0,
    p95FirstByteLatencyMs: percentile(bucket.firstByteLatencyDigest, 95),
    p95TotalLatencyMs: percentile(bucket.totalLatencyDigest, 95),
    promptTokens: bucket.promptTokens,
    completionTokens: bucket.completionTokens,
    totalTokens: bucket.totalTokens,
  };
}

function percentile(values: number[], targetPercentile: number): number {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil((targetPercentile / 100) * sorted.length) - 1);
  return Math.round(sorted[index] ?? 0);
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}
