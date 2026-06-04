import type {
  AdminContentSafetyTestDocument,
  ContentSafetyCheckMethod,
  ContentSafetyCheckRecord,
  ContentSafetyCheckSource,
  ContentSafetyConfig,
} from "../shared/types.ts";

export interface ContentSafetyCheckCommand {
  appId: string;
  userId?: string;
  requestId?: string;
  taskType?: string;
  source?: ContentSafetyCheckSource;
  text: string;
}

export interface ContentSafetyCheckResult {
  allowed: boolean;
  layer: "disabled" | "empty" | "keyword" | "llm" | "aliyun" | "failed_open";
  failureReason?: string;
  failureDetail?: string;
  llmDebug?: AdminContentSafetyTestDocument["llmDebug"];
}

export type ContentSafetyDecisionLayer = "keyword" | "llm" | "aliyun";

export type ContentSafetyStatsFilter = {
  dateFrom?: string;
  dateTo?: string;
  appId?: string;
  source?: string;
  method?: string;
  taskType?: string;
};

export interface ContentSafetyRecordInput {
  method: ContentSafetyCheckMethod;
  decision: ContentSafetyCheckRecord["decision"];
  text: string;
  blockedText?: string;
  category?: string;
  keywordId?: string;
  latencyMs?: number;
  modelKey?: string;
  provider?: string;
  providerModel?: string;
  failureReason?: string;
  failureDetail?: string;
  metadata?: Record<string, unknown>;
}

export type ContentSafetyThrowSensitive = (
  layer: ContentSafetyDecisionLayer,
  category?: string,
  llmDebug?: AdminContentSafetyTestDocument["llmDebug"],
  keywordId?: string,
) => never;

export type ContentSafetyDecisionLogger = (
  level: "info" | "warn",
  message: string,
  command: ContentSafetyCheckCommand,
  config: ContentSafetyConfig,
  layer: ContentSafetyDecisionLayer,
  context: Record<string, unknown>,
) => void;
