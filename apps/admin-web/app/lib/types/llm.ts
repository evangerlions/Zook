import type { AdminAppSummary, ConfigRevisionMeta } from "./core";

export type LlmMetricsRange = "24h" | "7d" | "30d";
export type LlmRoutingStrategy = "auto" | "fixed";
export type LlmModelKind = "chat" | "embedding";

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

export interface LlmServiceConfig {
  enabled: boolean;
  defaultModelKey: string;
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

export interface AdminLlmMetricsDocument {
  timezone: string;
  range: LlmMetricsRange;
  summary: LlmMetricsSummary;
  models: LlmModelMetricsGroup[];
}

export interface AdminLlmModelMetricsDocument {
  timezone: string;
  range: LlmMetricsRange;
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
  providers: LlmProviderDraft[];
  models: LlmModelDraft[];
}
