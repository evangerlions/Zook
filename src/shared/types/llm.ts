import type {
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
  weight: number;
  totalCalls: number;
  sampleSize: number;
  successRate: number;
  healthScore: number;
  effectiveProbability?: number;
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
  successRate: number;
  avgFirstByteLatencyMs: number;
  avgTotalLatencyMs: number;
  p95FirstByteLatencyMs: number;
  p95TotalLatencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmHourlySeriesItem extends LlmMetricsSummary {
  hour: string;
}

export interface LlmModelMetricsGroup {
  modelKey: string;
  label: string;
  summary: LlmMetricsSummary;
  items: LlmHourlySeriesItem[];
}

export interface LlmRouteMetricsGroup {
  modelKey: string;
  provider: string;
  providerModel: string;
  summary: LlmMetricsSummary;
  items: LlmHourlySeriesItem[];
}

export interface LlmProviderMetricsOption {
  provider: string;
  label: string;
}

export interface AdminLlmMetricsDocument {
  timezone: string;
  range: LlmMetricsRange;
  provider?: string;
  summary: LlmMetricsSummary;
  providers: LlmProviderMetricsOption[];
  models: LlmModelMetricsGroup[];
}

export interface AdminLlmModelMetricsDocument {
  timezone: string;
  range: LlmMetricsRange;
  provider?: string;
  modelKey: string;
  label: string;
  summary: LlmMetricsSummary;
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
