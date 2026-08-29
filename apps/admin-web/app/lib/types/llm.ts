import type { AdminAppSummary, ConfigRevisionMeta } from "./core";

export type LlmMetricsRange = "24h" | "48h" | "7d" | "30d";
export type LlmMetricsOperation = "chat" | "embedding";
export interface LlmMetricsFilters { provider?: string; providerModel?: string; operation?: LlmMetricsOperation }
export type LlmRoutingStrategy = "auto" | "fixed";
export type LlmModelKind = "chat" | "embedding";
export type LlmSmokeTestMode = "matrix" | "route";

export interface LlmProviderConfig {
  key: string;
  label: string;
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

export interface LlmModelRouteConfig {
  provider: string;
  providerModel: string;
  enabled: boolean;
  weight: number;
}

export interface LlmModelConfig {
  key: string;
  label: string;
  kind: LlmModelKind;
  strategy: LlmRoutingStrategy;
  routes: LlmModelRouteConfig[];
}

export interface OpenRouterConfig {
  useTransparentProxy: boolean;
  transparentProxyBaseUrl: string;
  transparentProxyKeyId: string;
  transparentProxyHmacSecretKey: string;
}

export interface LlmServiceConfig {
  enabled: boolean;
  defaultModelKey: string;
  openRouter: OpenRouterConfig;
  providers: LlmProviderConfig[];
  models: LlmModelConfig[];
}

export interface LlmRouteRuntimeStatus {
  provider: string;
  providerModel: string;
  enabled: boolean;
  providerEnabled: boolean;
  selectionEligible: boolean;
  runtimeAvailable: boolean;
  ineligibleReason?: "route_disabled" | "provider_disabled";
  weight: number;
  configuredWeight: number;
  sampleSize: number;
  successRate: number;
  healthScore: number;
  dynamicScore: number;
  effectiveProbability: number;
  selectionReason: "health_weighted" | "static_weight_fallback" | "fixed_highest_weight" | "compatibility_fallback" | "not_selected" | "ineligible";
  selected: boolean;
  lastErrorAt?: string;
}

export interface LlmModelRuntimeStatus {
  key: string;
  kind: LlmModelKind;
  strategy: LlmRoutingStrategy;
  routes: LlmRouteRuntimeStatus[];
}

export interface LlmRuntimeSnapshot {
  generatedAt: string;
  configRevision?: number;
  configUpdatedAt?: string;
  models: LlmModelRuntimeStatus[];
}

export interface AdminLlmServiceDocument {
  app: AdminAppSummary;
  configKey: string;
  config: LlmServiceConfig;
  runtime: LlmRuntimeSnapshot;
  updatedAt?: string;
  revision?: number;
  desc?: string;
  isLatest: boolean;
  revisions: ConfigRevisionMeta[];
}

export interface LlmMetricsSummary {
  requestCount: number;
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  cancelledCount: number;
  successRate: number;
  latencySampleCount: number;
  firstResponseSampleCount: number;
  avgFirstByteLatencyMs?: number;
  avgTotalLatencyMs?: number;
  p50FirstByteLatencyMs?: number;
  p95FirstByteLatencyMs?: number;
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

export interface LlmHourlySeriesItem extends LlmMetricsSummary {
  bucket: string;
  available: boolean;
}

export interface LlmModelMetricsGroup {
  modelKey: string;
  providerModel: string;
  label: string;
  operation: LlmMetricsOperation;
  summary: LlmMetricsSummary;
}

export interface LlmRouteMetricsGroup {
  routingModelKey: string;
  provider: string;
  providerModel: string;
  operation: LlmMetricsOperation;
  summary: LlmMetricsSummary;
  actualTrafficShare: number;
}

export interface LlmCrossMetricsGroup {
  provider: string;
  providerModel: string;
  operation: LlmMetricsOperation;
  summary: LlmMetricsSummary;
}

export interface LlmProviderMetricsGroup {
  provider: string;
  label: string;
  operation: LlmMetricsOperation;
  summary: LlmMetricsSummary;
  trafficShare: number;
}

export interface LlmProviderMetricsOption {
  provider: string;
  label: string;
}

export interface LlmBoundedMetricsGroup<T> {
  items: T[];
  totalCount: number;
  truncated: boolean;
}

export interface AdminLlmMetricsDocument {
  generatedAt: string;
  dataAvailableSince?: string;
  timezone: string;
  range: LlmMetricsRange;
  granularity: "hour" | "day";
  operation?: LlmMetricsOperation;
  provider?: string;
  providerModel?: string;
  summary: LlmMetricsSummary;
  latencyByOperation: Partial<Record<LlmMetricsOperation, LlmMetricsSummary>>;
  items: LlmHourlySeriesItem[];
  providers: LlmProviderMetricsOption[];
  providerMetrics: LlmBoundedMetricsGroup<LlmProviderMetricsGroup>;
  models: LlmBoundedMetricsGroup<LlmModelMetricsGroup>;
  routes: LlmBoundedMetricsGroup<LlmRouteMetricsGroup>;
  crossMetrics: LlmBoundedMetricsGroup<LlmCrossMetricsGroup>;
  runtime: LlmRuntimeSnapshot;
  routingConfigChangedWithinRange: boolean;
}

export interface AdminLlmModelMetricsDocument {
  generatedAt: string;
  dataAvailableSince?: string;
  timezone: string;
  range: LlmMetricsRange;
  granularity: "hour" | "day";
  provider?: string;
  modelKey: string;
  label: string;
  summary: LlmMetricsSummary;
  items: LlmHourlySeriesItem[];
  routes: LlmRouteMetricsGroup[];
}

export interface AdminLlmSmokeTestSummary {
  totalCount: number;
  attemptedCount: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  successRate: number;
}

export interface AdminLlmSmokeTestRunRequest {
  mode?: LlmSmokeTestMode;
  modelKey?: string;
  provider?: string;
}

export interface AdminLlmSmokeTestTarget {
  mode: LlmSmokeTestMode;
  modelKey?: string;
  provider?: string;
}

export interface AdminLlmSmokeTestItem {
  modelKey: string;
  modelLabel: string;
  modelKind: LlmModelKind;
  provider: string;
  providerLabel: string;
  providerModel: string;
  configured: boolean;
  status: "success" | "failed" | "skipped";
  latencyMs?: number;
  message: string;
  responsePreview?: string;
  details: {
    request?: Record<string, unknown>;
    response?: Record<string, unknown>;
    error?: Record<string, unknown>;
    skip?: Record<string, unknown>;
  };
}

export interface AdminLlmSmokeTestDocument {
  executedAt: string;
  cooldownSeconds: number;
  target: AdminLlmSmokeTestTarget;
  summary: AdminLlmSmokeTestSummary;
  items: AdminLlmSmokeTestItem[];
}

export interface LlmProviderDraft {
  key: string;
  label: string;
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  timeoutMs: string;
}

export interface LlmRouteDraft {
  provider: string;
  providerModel: string;
  enabled: boolean;
  weight: string;
}

export interface LlmModelDraft {
  key: string;
  label: string;
  kind: LlmModelKind;
  strategy: LlmRoutingStrategy;
  routes: LlmRouteDraft[];
}

export interface LlmConfigDraft {
  enabled: boolean;
  defaultModelKey: string;
  openRouter: OpenRouterConfig;
  providers: LlmProviderDraft[];
  models: LlmModelDraft[];
}
