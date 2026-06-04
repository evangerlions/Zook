import type { AdminAppSummary, ConfigRevisionMeta } from "./core";

export interface RemoteLogPullSettings {
  enabled: boolean;
  minPullIntervalSeconds: number;
  claimTtlSeconds: number;
  taskDefaults: {
    lookbackMinutes: number;
    maxLines: number;
    maxBytes: number;
  };
}

export interface AdminRemoteLogPullSettingsDocument {
  app: AdminAppSummary;
  configKey: string;
  config: RemoteLogPullSettings;
  updatedAt?: string;
  revision?: number;
  desc?: string;
  isLatest: boolean;
  revisions: ConfigRevisionMeta[];
}

export interface AdminRemoteLogPullTaskSummary {
  taskId: string;
  userId: string;
  did: string;
  keyId: string;
  status: "PENDING" | "CLAIMED" | "COMPLETED" | "CANCELLED" | "FAILED";
  fromTsMs?: number;
  toTsMs?: number;
  maxLines?: number;
  maxBytes?: number;
  claimExpireAt?: string;
  uploadedAt?: string;
  uploadedFileName?: string;
  uploadedFileSizeBytes?: number;
  uploadedLineCount?: number;
  failedAt?: string;
  failureReason?: string;
  createdAt: string;
}

export interface AdminRemoteLogPullTaskListDocument {
  app: AdminAppSummary;
  items: AdminRemoteLogPullTaskSummary[];
}

export interface AdminRemoteLogPullTaskDocument {
  app: AdminAppSummary;
  item: AdminRemoteLogPullTaskSummary;
}

export interface AdminRemoteLogPullTaskFileDocument {
  appId: string;
  taskId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  lineCount?: number;
  content: string;
}
