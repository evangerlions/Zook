import type {
  AnalyticsEventInput as GeneratedAnalyticsEventInput,
  FileConfirmData as GeneratedFileConfirmData,
  FilePresignData as GeneratedFilePresignData,
  LogFailData as GeneratedLogFailData,
  LogNoDataAckData as GeneratedLogNoDataAckData,
  LogPolicyData as GeneratedLogPolicyData,
  LogPullTaskData as GeneratedLogPullTaskData,
  LogUploadData as GeneratedLogUploadData,
  NotificationQueuedData as GeneratedNotificationQueuedData,
} from "../../generated/openapi/public-contracts.generated.ts";
import type { Platform } from "./enums.ts";
import type { AuthContext } from "./http.ts";

export type AnalyticsEventInput = GeneratedAnalyticsEventInput;

export interface MetricsOverviewItem {
  date: string;
  dau: number;
  newUsers: number;
}

export interface PageMetricItem {
  pageKey: string;
  platform: Platform;
  uv: number;
  sessionCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
}

export type FilePresignResult = GeneratedFilePresignData;

export type FileConfirmResult = GeneratedFileConfirmData;

export type NotificationQueueResult = GeneratedNotificationQueuedData;

export type LogPullTaskResult = GeneratedLogPullTaskData;

export type LogPolicyResult = GeneratedLogPolicyData;

export type LogUploadResult = GeneratedLogUploadData;

export type LogNoDataAckResult = GeneratedLogNoDataAckData;

export type LogFailResult = GeneratedLogFailData;

export interface LogFailCommand {
  auth: AuthContext;
  did: string;
  taskId: string;
  claimToken: string;
  failureReason?: string;
  now?: Date;
}

export interface QueueJob<T = Record<string, unknown>> {
  id: string;
  name: string;
  payload: T;
  attemptsMade: number;
  maxAttempts: number;
  backoffMs: number;
  availableAt: string;
  failedReason?: string;
}

export interface LogRecord {
  timestamp: string;
  level: "info" | "warn" | "error";
  service: string;
  message: string;
  requestId?: string;
  appId?: string;
  userId?: string;
  path?: string;
  statusCode?: number;
  latencyMs?: number;
  jobName?: string;
  jobId?: string;
  error?: string;
}
