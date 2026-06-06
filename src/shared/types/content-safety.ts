import type { ContentSafetyCheckMethod, ContentSafetyCheckSource } from "./enums.ts";
import type { ConfigRevisionMeta } from "./records.ts";
import type { AdminAppSummary } from "./admin-core.ts";

export interface ContentSafetyKeywordRule {
  id: string;
  term: string;
  enabled: boolean;
  category?: string;
  note?: string;
}

export interface ContentSafetyKeywordConfig {
  enabled: boolean;
  rules: ContentSafetyKeywordRule[];
}

export interface ContentSafetyLlmConfig {
  enabled: boolean;
  modelKey: string;
  timeoutMs: number;
}

export interface ContentSafetyAliyunConfig {
  enabled: boolean;
  endpoint: string;
  region: string;
  service: string;
  accessKeyIdPasswordKey: string;
  accessKeySecretPasswordKey: string;
  timeoutMs: number;
}

export interface ContentSafetyConfig {
  enabled: boolean;
  longTextThresholdChars: number;
  keyword: ContentSafetyKeywordConfig;
  llm: ContentSafetyLlmConfig;
  aliyun: ContentSafetyAliyunConfig;
}

export interface AdminContentSafetyDocument {
  app: AdminAppSummary;
  configKey: string;
  config: ContentSafetyConfig;
  updatedAt?: string;
  revision?: number;
  desc?: string;
  isLatest: boolean;
  revisions: ConfigRevisionMeta[];
}

export interface AdminContentSafetyTestDocument {
  allowed: boolean;
  blocked: boolean;
  layer: "disabled" | "empty" | "keyword" | "llm" | "aliyun" | "failed_open";
  code: "OK" | "AI_INPUT_CONTENT_SENSITIVE";
  message: string;
  textLength: number;
  elapsedMs: number;
  category?: string;
  keywordId?: string;
  failureReason?: string;
  failureDetail?: string;
  llmDebug?: {
    latencyMs?: number;
    input: {
      modelKey: string;
      temperature: number;
      maxTokens: number;
      timeoutMs: number;
      providerOptions?: Record<string, unknown>;
      messages: Array<{
        role: string;
        content?: string;
      }>;
    };
    output?: {
      provider: string;
      modelKey: string;
      providerModel: string;
      text: string;
      toolCalls?: Array<{
        id: string;
        name: string;
        input: Record<string, unknown>;
      }>;
      reasoningText?: string;
      finishReason?: string;
      providerRequestId?: string;
      usage?: Record<string, unknown>;
      parsedDecision?: {
        blocked: boolean;
        category?: string;
      };
      parseError?: {
        reason: string;
        detail: string;
      };
    };
  };
}

export interface AdminContentSafetyBlockRecordItem {
  id: string;
  appId: string;
  userId?: string;
  requestId?: string;
  taskType?: string;
  source: ContentSafetyCheckSource;
  method: Exclude<ContentSafetyCheckMethod, "disabled" | "failed_open">;
  category?: string;
  keywordId?: string;
  text: string;
  textLength: number;
  textHash: string;
  modelKey?: string;
  provider?: string;
  providerModel?: string;
  createdAt: string;
}

export interface AdminContentSafetyBlockRecordsDocument {
  timezone: string;
  items: AdminContentSafetyBlockRecordItem[];
}

export interface AdminContentSafetyStatsBucket {
  key: string;
  count: number;
  blocked: number;
  failedOpen: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
}

export interface AdminContentSafetyDailyStatsItem {
  date: string;
  total: number;
  passed: number;
  blocked: number;
  failedOpen: number;
}

export interface AdminContentSafetyStatsDocument {
  timezone: string;
  summary: {
    total: number;
    passed: number;
    blocked: number;
    failedOpen: number;
    blockRate: number;
    failedOpenRate: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
  };
  daily: AdminContentSafetyDailyStatsItem[];
  byMethod: AdminContentSafetyStatsBucket[];
  bySource: AdminContentSafetyStatsBucket[];
  byApp: AdminContentSafetyStatsBucket[];
  byTaskType: AdminContentSafetyStatsBucket[];
  byCategory: AdminContentSafetyStatsBucket[];
  byFailureReason: AdminContentSafetyStatsBucket[];
  byLengthBucket: AdminContentSafetyStatsBucket[];
}
