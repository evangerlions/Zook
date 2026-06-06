import type { AdminAppSummary, ConfigRevisionMeta } from "./core";

export interface ContentSafetyKeywordRule {
  id: string;
  term: string;
  enabled: boolean;
  category?: string;
  note?: string;
}

export interface ContentSafetyConfig {
  enabled: boolean;
  longTextThresholdChars: number;
  keyword: {
    enabled: boolean;
    rules: ContentSafetyKeywordRule[];
  };
  llm: {
    enabled: boolean;
    modelKey: string;
    timeoutMs: number;
  };
  aliyun: {
    enabled: boolean;
    endpoint: string;
    region: string;
    service: string;
    accessKeyIdPasswordKey: string;
    accessKeySecretPasswordKey: string;
    timeoutMs: number;
  };
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

export type ContentSafetyCheckSource = "business" | "admin_test";
export type ContentSafetyCheckMethod = "disabled" | "keyword" | "llm" | "aliyun" | "failed_open";

export interface AdminContentSafetyBlockRecordItem {
  id: string;
  appId: string;
  userId?: string;
  requestId?: string;
  taskType?: string;
  source: ContentSafetyCheckSource;
  method: "keyword" | "llm" | "aliyun";
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
  daily: Array<{
    date: string;
    total: number;
    passed: number;
    blocked: number;
    failedOpen: number;
  }>;
  byMethod: AdminContentSafetyStatsBucket[];
  bySource: AdminContentSafetyStatsBucket[];
  byApp: AdminContentSafetyStatsBucket[];
  byTaskType: AdminContentSafetyStatsBucket[];
  byCategory: AdminContentSafetyStatsBucket[];
  byFailureReason: AdminContentSafetyStatsBucket[];
  byLengthBucket: AdminContentSafetyStatsBucket[];
}
