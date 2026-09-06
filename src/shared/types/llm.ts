import type {
  LlmMetricsGranularity,
  LlmMetricsOperation,
  LlmMetricsRange,
  LlmModelKind,
  LlmRoutingStrategy,
  LlmSmokeTestMode,
  LlmSmokeTestStatus,
} from "./enums.ts";
import type { ConfigRevisionMeta } from "./records.ts";
import type { AdminAppSummary } from "./admin-core.ts";

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

export interface TransparentProxyConfig {
  useTransparentProxy: boolean;
  transparentProxyBaseUrl: string;
  transparentProxyKeyId: string;
  transparentProxyHmacSecretKey: string;
}

export interface OpenRouterConfig extends TransparentProxyConfig {}

export interface BaiConfig extends TransparentProxyConfig {}

export interface LlmServiceConfig {
  enabled: boolean;
  defaultModelKey: string;
  openRouter: OpenRouterConfig;
  bai: BaiConfig;
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
  ineligibleReason?: "route_disabled" | "provider_disabled" | "runtime_unavailable";
  weight: number;
  configuredWeight: number;
  sampleSize: number;
  successRate?: number;
  healthScore: number;
  dynamicScore: number;
  effectiveProbability: number;
  selectionReason:
    | "health_weighted"
    | "static_weight_fallback"
    | "fixed_highest_weight"
    | "compatibility_fallback"
    | "not_selected"
    | "ineligible";
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
  successRate?: number;
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

export interface LlmHealthFailureMetricsGroup {
  routingModelKey: string;
  provider: string;
  providerModel: string;
  operation: LlmMetricsOperation;
  errorCode: string;
  errorMessage?: string;
  count: number;
  lastOccurredAt: string;
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
  granularity: LlmMetricsGranularity;
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
  healthFailures: LlmBoundedMetricsGroup<LlmHealthFailureMetricsGroup>;
  runtime: LlmRuntimeSnapshot;
  routingConfigChangedWithinRange: boolean;
}

export interface AdminLlmModelMetricsDocument {
  generatedAt: string;
  dataAvailableSince?: string;
  timezone: string;
  range: LlmMetricsRange;
  granularity: LlmMetricsGranularity;
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

export interface AdminLlmSmokeTestRequestPayload {
  modelKind: LlmModelKind;
  provider: string;
  modelKey: string;
  providerModel: string;
  baseUrl: string;
  timeoutMs: number;
  messages?: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  input?: string[];
  temperature?: number;
  maxTokens?: number;
  providerOptions: Record<string, unknown>;
}

export interface AdminLlmSmokeTestResponsePayload {
  modelKind: LlmModelKind;
  provider: string;
  modelKey: string;
  providerModel: string;
  text?: string;
  reasoningText?: string;
  finishReason?: string;
  vectorCount?: number;
  dimensions?: number;
  vectorPreview?: Array<{
    index: number;
    embedding: number[];
  }>;
  providerRequestId?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    reasoningTokens?: number;
    estimated?: boolean;
  };
}

export interface AdminLlmSmokeTestErrorPayload {
  name: string;
  message: string;
  code?: string;
  statusCode?: number;
  details?: unknown;
  stackPreview?: string[];
}

export interface AdminLlmSmokeTestSkipPayload {
  reason: string;
  configured: boolean;
  providerEnabled: boolean;
  routeEnabled?: boolean;
}

export interface AdminLlmSmokeTestDetails {
  request?: AdminLlmSmokeTestRequestPayload;
  response?: AdminLlmSmokeTestResponsePayload;
  error?: AdminLlmSmokeTestErrorPayload;
  skip?: AdminLlmSmokeTestSkipPayload;
}

export interface AdminLlmSmokeTestItem {
  modelKind: LlmModelKind;
  modelKey: string;
  modelLabel: string;
  provider: string;
  providerLabel: string;
  providerModel: string;
  configured: boolean;
  status: LlmSmokeTestStatus;
  latencyMs?: number;
  message: string;
  responsePreview?: string;
  details: AdminLlmSmokeTestDetails;
}

export interface AdminLlmSmokeTestDocument {
  executedAt: string;
  cooldownSeconds: number;
  target: AdminLlmSmokeTestTarget;
  summary: AdminLlmSmokeTestSummary;
  items: AdminLlmSmokeTestItem[];
}
