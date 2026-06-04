import type {
  AppStatus,
  AppUserStatus,
  ContentSafetyCheckMethod,
  ContentSafetyCheckSource,
  ContentSafetyDecision,
  EventName,
  FileStatus,
  JoinMode,
  NotificationStatus,
  PermissionStatus,
  Platform,
  RoleStatus,
  UserStatus,
} from "./enums.ts";
import type { SmsVerificationRecord } from "./sms-verification.ts";

export interface AppRecord {
  id: string;
  code: string;
  name: string;
  nameI18n: AppNameI18n;
  status: AppStatus;
  apiDomain?: string;
  joinMode: JoinMode;
  createdAt: string;
}

export interface AppNameI18n {
  "zh-CN": string;
  "en-US": string;
  [locale: string]: string;
}

export interface UserRecord {
  id: string;
  email?: string;
  phone?: string;
  passwordHash: string;
  passwordAlgo: string;
  status: UserStatus;
  createdAt: string;
}

export interface AppUserRecord {
  id: string;
  appId: string;
  userId: string;
  status: AppUserStatus;
  joinedAt: string;
}

export interface RoleRecord {
  id: string;
  appId: string;
  code: string;
  name: string;
  status: RoleStatus;
}

export interface PermissionRecord {
  id: string;
  code: string;
  name: string;
  status: PermissionStatus;
}

export interface RolePermissionRecord {
  id: string;
  roleId: string;
  permissionId: string;
}

export interface UserRoleRecord {
  id: string;
  appId: string;
  userId: string;
  roleId: string;
}

export interface RefreshTokenRecord {
  id: string;
  appId: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt?: string;
  replacedBy?: string;
}

export interface AdminSessionRecord {
  id: string;
  username: string;
  createdAt: string;
  expiresAt: string;
}

export interface AuditLogRecord {
  id: string;
  appId: string;
  actorUserId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  resourceOwnerUserId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface NotificationJobRecord {
  id: string;
  appId: string;
  recipientUserId: string;
  channel: "email" | "sms" | "push";
  payload: Record<string, unknown>;
  status: NotificationStatus;
  retryCount: number;
}

export interface FailedEventRecord {
  id: string;
  appId: string;
  eventType: string;
  payload: Record<string, unknown>;
  errorMessage: string;
  retryCount: number;
  nextRetryAt: string;
  createdAt: string;
}

export interface AppConfigRecord {
  id: string;
  appId: string;
  configKey: string;
  configValue: string;
  updatedAt: string;
}

export interface ConfigRevisionMeta {
  revision: number;
  desc: string;
  createdAt: string;
}

export interface ConfigRevisionRecord<T = string> extends ConfigRevisionMeta {
  content: T;
}

export interface AnalyticsEventRecord {
  id: string;
  appId: string;
  userId: string;
  platform: Platform;
  sessionId: string;
  pageKey: string;
  eventName: EventName;
  durationMs?: number;
  occurredAt: string;
  receivedAt: string;
  metadata: Record<string, unknown>;
}

export interface FileRecord {
  id: string;
  appId: string;
  ownerUserId: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  status: FileStatus;
  createdAt: string;
}

export type ClientLogUploadTaskStatus =
  | "PENDING"
  | "CLAIMED"
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED";

export interface ClientLogUploadTaskRecord {
  id: string;
  appId: string;
  userId?: string;
  did?: string;
  keyId: string;
  fromTsMs?: number;
  toTsMs?: number;
  maxLines?: number;
  maxBytes?: number;
  status: ClientLogUploadTaskStatus;
  claimToken?: string;
  claimExpireAt?: string;
  createdAt: string;
  expiresAt?: string;
  uploadedAt?: string;
  uploadedFileName?: string;
  uploadedFilePath?: string;
  uploadedFileSizeBytes?: number;
  uploadedLineCount?: number;
  failedAt?: string;
  failureReason?: string;
}

export interface ClientLogUploadRecord {
  id: string;
  taskId: string;
  appId: string;
  userId: string;
  keyId: string;
  encryption: "aes-256-gcm";
  contentEncoding: "ndjson+gzip";
  nonceBase64: string;
  lineCountReported?: number;
  plainBytesReported?: number;
  compressedBytesReported?: number;
  encryptedBytes: number;
  acceptedCount: number;
  rejectedCount: number;
  uploadedAt: string;
}

export interface ClientLogLineRecord {
  id: string;
  uploadId: string;
  taskId: string;
  appId: string;
  userId: string;
  timestampMs?: number;
  level?: string;
  message?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ContentSafetyCheckRecord {
  id: string;
  appId: string;
  userId?: string;
  requestId?: string;
  taskType?: string;
  source: ContentSafetyCheckSource;
  method: ContentSafetyCheckMethod;
  decision: ContentSafetyDecision;
  category?: string;
  keywordId?: string;
  text?: string;
  textLength: number;
  textHash: string;
  latencyMs?: number;
  modelKey?: string;
  provider?: string;
  providerModel?: string;
  failureReason?: string;
  failureDetail?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface DatabaseSeed {
  apps?: AppRecord[];
  users?: UserRecord[];
  appUsers?: AppUserRecord[];
  roles?: RoleRecord[];
  permissions?: PermissionRecord[];
  rolePermissions?: RolePermissionRecord[];
  userRoles?: UserRoleRecord[];
  refreshTokens?: RefreshTokenRecord[];
  auditLogs?: AuditLogRecord[];
  notificationJobs?: NotificationJobRecord[];
  failedEvents?: FailedEventRecord[];
  smsVerificationRecords?: SmsVerificationRecord[];
  appConfigs?: AppConfigRecord[];
  analyticsEvents?: AnalyticsEventRecord[];
  files?: FileRecord[];
  clientLogUploadTasks?: ClientLogUploadTaskRecord[];
  clientLogUploads?: ClientLogUploadRecord[];
  clientLogLines?: ClientLogLineRecord[];
  contentSafetyCheckRecords?: ContentSafetyCheckRecord[];
}
