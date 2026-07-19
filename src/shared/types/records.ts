import type {
  AccountRegion,
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
  accountRegion: AccountRegion;
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

export interface FrogSleepDeviceRecord {
  id: string;
  appId: string;
  userId: string;
  platform: "ios" | "android" | "web";
  pushToken: string;
  appVersion?: string;
  timezone?: string;
  pushEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export type FrogSleepEntityKind =
  | "sleep_invite"
  | "sleep_relationship"
  | "guardianship_preference"
  | "sleep_session"
  | "sleep_event"
  | "sleep_summary"
  | "night_recap"
  | "focus_profile"
  | "focus_relationship"
  | "focus_invite"
  | "focus_session"
  | "focus_shared_moment"
  | "focus_message"
  | "focus_milestone"
  | "focus_match_feedback"
  | "buddy_share"
  | "buddy_interaction"
  | "buddy_joint_activity"
  | "buddy_joint_goal"
  | "buddy_goal_contribution"
  | "buddy_milestone"
  | "buddy_weekly_report"
  | "sleep_report_snapshot"
  | "progress_snapshot"
  | "entitlement_record";

export interface FrogSleepEntityRecord {
  id: string;
  appId: string;
  kind: FrogSleepEntityKind;
  ownerUserId?: string;
  partnerUserId?: string;
  relationshipId?: string;
  sessionId?: string;
  status?: string;
  code?: string;
  token?: string;
  startsAt?: string;
  endsAt?: string;
  occurredAt?: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface FrogSleepEntityFilter {
  appId: string;
  kind?: FrogSleepEntityKind;
  ownerUserId?: string;
  partnerUserId?: string;
  relationshipId?: string;
  sessionId?: string;
  status?: string;
  code?: string;
  token?: string;
  startsAtFromIso?: string;
  startsAtToIso?: string;
  occurredAtFromIso?: string;
  occurredAtToIso?: string;
  includeDeleted?: boolean;
  limit?: number;
}

export interface FrogSleepBuddySharingGrantRecord {
  id: string;
  appId: string;
  relationshipId: string;
  grantorUserId: string;
  granteeUserId: string;
  domain: "sleep" | "focus";
  category: "presence" | "daily_summary" | "weekly_trend" | "shared_activity";
  state: "granted" | "revoked";
  version: number;
  grantedAt?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FrogSleepBuddyInvitationBundleRecord {
  id: string;
  appId: string;
  inviterUserId: string;
  inviteeUserId?: string;
  status: "pending" | "accepted" | "declined" | "cancelled" | "expired";
  domains: Array<"sleep" | "focus">;
  version: number;
  domainInvitationIds: Partial<Record<"sleep" | "focus", string>>;
  domainErrorCodes: Partial<Record<"sleep" | "focus", string>>;
  lastIdempotencyKey?: string;
  lastResponseAction?: "accept" | "decline" | "cancel";
  responsePayload?: Record<string, unknown>;
  expiresAt: string;
  respondedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FrogSleepBuddyInvitationDomainDecisionRecord {
  appId: string;
  invitationId: string;
  domain: "sleep" | "focus";
  status: "pending" | "accepted" | "declined" | "cancelled" | "expired";
  version: number;
  decidedByUserId?: string;
  decidedAt?: string;
  idempotencyKeyHash?: string;
  terminalReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FrogSleepBuddyDomainSlotRecord {
  appId: string;
  userId: string;
  domain: "sleep" | "focus";
  state: "available" | "occupied";
  relationshipId?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface FrogSleepBuddyDomainRelationshipRecord {
  id: string;
  appId: string;
  domain: "sleep" | "focus";
  userIdLow: string;
  userIdHigh: string;
  status: "active" | "paused" | "revoked";
  pausedByUserIds: string[];
  version: number;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FrogSleepBuddyInvitationReceiptAttemptRecord {
  id: string;
  appId: string;
  inviterUserId: string;
  inviteeUserId?: string;
  recipientIdentityHash: string;
  domains: Array<"sleep" | "focus">;
  domainsFingerprint: string;
  status: "recorded" | "decoy";
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface FrogSleepBuddyNotificationOutboxRecord {
  id: string;
  appId: string;
  recipientUserId: string;
  eventType: string;
  targetType: string;
  targetId: string;
  deduplicationKey: string;
  safeRoute: Record<string, string>;
  status: "pending" | "processing" | "delivered" | "failed" | "dead_letter";
  attemptCount: number;
  availableAt: string;
  processedAt?: string;
  lastErrorCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FrogSleepBuddyNotificationRecord {
  id: string;
  appId: string;
  recipientUserId: string;
  outboxId: string;
  notificationType: string;
  targetType: string;
  targetId: string;
  safeRoute: Record<string, string>;
  readAt?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FrogSleepBuddyNotificationDeliveryRecord {
  id: string;
  appId: string;
  notificationId: string;
  channel: "in_app" | "apns";
  status: "pending" | "delivered" | "failed" | "suppressed";
  attempt: number;
  providerMessageId?: string;
  errorCode?: string;
  deliveredAt?: string;
  createdAt: string;
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

export const FEEDBACK_STATUSES = ["new", "doing", "done"] as const;
export type FeedbackStatus = typeof FEEDBACK_STATUSES[number];

export interface FeedbackRecord {
  id: string;
  appId: string;
  userId: string;
  message: string;
  messageHash: string;
  status: FeedbackStatus;
  platform?: string;
  appVersion?: string;
  locale?: string;
  ipHash?: string;
  userAgent?: string;
  metadata: Record<string, unknown>;
  attachmentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackAttachmentRecord {
  id: string;
  feedbackId: string;
  appId: string;
  userId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  storagePath: string;
  createdAt: string;
}

export interface AiNovelStatisticsSnapshotRecord {
  appId: string;
  userId: string;
  totalWorks: number;
  totalWords: number;
  totalChapters: number;
  activeWritingDays: number;
  updatedAt: string;
}

export interface AiNovelDailyStatisticsRecord {
  appId: string;
  userId: string;
  date: string;
  words: number;
  tokens: number;
  active: boolean;
  updatedAt: string;
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
  feedbackRecords?: FeedbackRecord[];
  feedbackAttachments?: FeedbackAttachmentRecord[];
  frogSleepBuddyInvitationDomainDecisions?: FrogSleepBuddyInvitationDomainDecisionRecord[];
  frogSleepBuddyDomainSlots?: FrogSleepBuddyDomainSlotRecord[];
  frogSleepBuddyDomainRelationships?: FrogSleepBuddyDomainRelationshipRecord[];
  frogSleepBuddyInvitationReceiptAttempts?: FrogSleepBuddyInvitationReceiptAttemptRecord[];
  aiNovelStatisticsSnapshots?: AiNovelStatisticsSnapshotRecord[];
  aiNovelDailyStatistics?: AiNovelDailyStatisticsRecord[];
}
