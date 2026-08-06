import type {
  AiNovelDailyStatisticsRecord,
  AiNovelStatisticsSnapshotRecord,
} from "./ai-novel-statistics.ts";
import type {
  FrogSleepBuddyGroupInvitationRecord,
  FrogSleepBuddyGroupMemberRecord,
  FrogSleepBuddyGroupRecord,
} from "./frogsleep-buddy-group.ts";
import type {
  AiOutputReactionRecord,
  AiOutputReportRecord,
  AnalyticsEventRecord,
  AppConfigRecord,
  AppRecord,
  AppUserRecord,
  AuditLogRecord,
  ClientLogLineRecord,
  ClientLogUploadRecord,
  ClientLogUploadTaskRecord,
  ContentSafetyCheckRecord,
  FailedEventRecord,
  FeedbackAttachmentRecord,
  FeedbackRecord,
  FileRecord,
  FrogSleepBuddyDomainRelationshipRecord,
  FrogSleepBuddyDomainSlotRecord,
  FrogSleepBuddyInvitationDomainDecisionRecord,
  FrogSleepBuddyInvitationReceiptAttemptRecord,
  NotificationJobRecord,
  PermissionRecord,
  RefreshTokenRecord,
  RolePermissionRecord,
  RoleRecord,
  UserRecord,
  UserRoleRecord,
} from "./records.ts";
import type { SmsVerificationRecord } from "./sms-verification.ts";

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
  frogSleepBuddyGroups?: FrogSleepBuddyGroupRecord[];
  frogSleepBuddyGroupMembers?: FrogSleepBuddyGroupMemberRecord[];
  frogSleepBuddyGroupInvitations?: FrogSleepBuddyGroupInvitationRecord[];
  aiOutputReportRecords?: AiOutputReportRecord[];
  aiOutputReactionRecords?: AiOutputReactionRecord[];
  aiNovelStatisticsSnapshots?: AiNovelStatisticsSnapshotRecord[];
  aiNovelDailyStatistics?: AiNovelDailyStatisticsRecord[];
}
