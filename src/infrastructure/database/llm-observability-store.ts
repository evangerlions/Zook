export type LlmOperation = "chat" | "embedding";
export type LlmResponseMode = "stream" | "non_stream";
export type LlmCallOutcome = "success" | "failure" | "timeout" | "cancelled";
export type LlmHealthImpact = "success" | "failure" | "neutral";
export type LlmUsageSource = "provider" | "estimated" | "missing";
export type LlmMetricsGranularity = "hour" | "day";

export interface LlmCallObservationRecord {
  callId: string;
  occurredAt: string;
  appId?: string;
  routingModelKey: string;
  provider: string;
  providerModel: string;
  operation: LlmOperation;
  responseMode: LlmResponseMode;
  outcome: LlmCallOutcome;
  healthImpact: LlmHealthImpact;
  firstResponseLatencyMs?: number;
  totalLatencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  usageSource: LlmUsageSource;
  errorCode?: string;
  errorMessage?: string;
  routingConfigRevision?: number;
}

export interface LlmRouteHealthKey {
  routingModelKey: string;
  provider: string;
  providerModel: string;
  operation: LlmOperation;
}

export interface LlmRouteHealthRecord extends LlmRouteHealthKey {
  totalCalls: number;
  recentOutcomes: boolean[];
  lastErrorAt?: string;
  updatedAt: string;
}

export interface LlmObservabilityFilter {
  occurredAtFrom: string;
  occurredAtTo: string;
  granularity: LlmMetricsGranularity;
  operation?: LlmOperation;
  provider?: string;
  providerModel?: string;
  routingModelKey?: string;
  appId?: string;
}

export interface LlmObservationAggregate {
  requestCount: number;
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  cancelledCount: number;
  latencySampleCount: number;
  firstResponseSampleCount: number;
  avgFirstResponseLatencyMs?: number;
  avgTotalLatencyMs?: number;
  p50FirstResponseLatencyMs?: number;
  p95FirstResponseLatencyMs?: number;
  p50TotalLatencyMs?: number;
  p95TotalLatencyMs?: number;
  promptTokens?: number;
  visibleOutputTokens?: number;
  reasoningTokens?: number;
  unclassifiedTokens?: number;
  totalTokens?: number;
  providerUsageCount: number;
  estimatedUsageCount: number;
  missingUsageCount: number;
}

export interface LlmTimelineAggregate extends LlmObservationAggregate {
  bucket: string;
}

export interface LlmProviderAggregate extends LlmObservationAggregate {
  provider: string;
  operation: LlmOperation;
  operationRequestCount: number;
}

export interface LlmProviderModelAggregate extends LlmObservationAggregate {
  providerModel: string;
  operation: LlmOperation;
}

export interface LlmRouteAggregate extends LlmObservationAggregate {
  routingModelKey: string;
  provider: string;
  providerModel: string;
  operation: LlmOperation;
  routingModelRequestCount: number;
}

export interface LlmCrossAggregate extends LlmObservationAggregate {
  provider: string;
  providerModel: string;
  operation: LlmOperation;
}

export interface LlmHealthFailureAggregate {
  routingModelKey: string;
  provider: string;
  providerModel: string;
  operation: LlmOperation;
  errorCode: string;
  errorMessage?: string;
  count: number;
  lastOccurredAt: string;
}

export interface LlmBoundedAggregateGroup<T> {
  items: T[];
  totalCount: number;
  truncated: boolean;
}

export interface LlmObservabilityQueryResult {
  dataAvailableSince?: string;
  summary: LlmObservationAggregate;
  latencyByOperation: Partial<Record<LlmOperation, LlmObservationAggregate>>;
  timeline: LlmTimelineAggregate[];
  providers: LlmBoundedAggregateGroup<LlmProviderAggregate>;
  providerModels: LlmBoundedAggregateGroup<LlmProviderModelAggregate>;
  routes: LlmBoundedAggregateGroup<LlmRouteAggregate>;
  cross: LlmBoundedAggregateGroup<LlmCrossAggregate>;
  healthFailures: LlmBoundedAggregateGroup<LlmHealthFailureAggregate>;
  routingConfigRevisions: number[];
}

export interface LlmObservabilityStore {
  recordObservation(record: LlmCallObservationRecord): Promise<boolean>;
  getRouteHealth(key: LlmRouteHealthKey): Promise<LlmRouteHealthRecord | undefined>;
  queryMetrics(filter: LlmObservabilityFilter): Promise<LlmObservabilityQueryResult>;
  queryRoutingModelRequestCounts(filter: LlmObservabilityFilter): Promise<Record<string, number>>;
  deleteBefore(cutoffIso: string): Promise<{ observations: number }>;
}
