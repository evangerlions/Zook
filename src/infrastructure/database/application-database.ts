import type { BuddySupportRepository } from "../../modules/frogsleep/buddy-support/buddy-support.types.ts";
import type { ApplicationBodyLogDatabasePort } from './application-bodylog-database-port.ts';
import type { SleepGuestStore } from "../../modules/frogsleep/guest/guest-store.ts";
import type { PersonalSyncRepository } from "../../modules/frogsleep/personal-sync/personal-sync.types.ts";
import type { FrogSleepAdminStore } from "../../modules/frogsleep/admin/frogsleep-admin.types.ts";
import type { FrogSleepFocusSessionWriteResult } from "../../shared/frogsleep-focus-session.ts";
import type {
  AnalyticsEventRecord,
  AiNovelDailyStatisticsRecord,
  AiNovelStatisticsSnapshotRecord,
  AiOutputReactionRecord,
  AiOutputReportRecord,
  AppConfigRecord,
  AppNameI18n,
  AppRecord,
  AppUserRecord,
  AuditLogRecord,
  ClientLogLineRecord,
  ClientLogUploadRecord,
  ClientLogUploadTaskRecord,
  ContentSafetyCheckRecord,
  DatabaseSeed,
  EmailDeliveryEventRecord,
  FeedbackAttachmentRecord,
  FeedbackRecord,
  FailedEventRecord,
  FileRecord,
  FrogSleepDeviceRecord,
  FrogSleepBuddySharingGrantRecord,
  FrogSleepBuddyInvitationBundleRecord,
  FrogSleepBuddyInvitationEmailAttemptRecord,
  FrogSleepBuddyInvitationEmailDeliveryRecord,
  FrogSleepBuddyInvitationDomainDecisionRecord,
  FrogSleepBuddyDomainSlotRecord,
  FrogSleepBuddyDomainRelationshipRecord,
  FrogSleepBuddyInvitationReceiptAttemptRecord,
  FrogSleepBuddyNotificationOutboxRecord,
  FrogSleepBuddyNotificationRecord,
  FrogSleepBuddyNotificationDeliveryRecord,
  FrogSleepBuddyGroupRecord,
  FrogSleepBuddyGroupMemberRecord,
  FrogSleepBuddyGroupInvitationRecord,
  FrogSleepEntityFilter,
  FrogSleepEntityKind,
  FrogSleepEntityRecord,
  NotificationJobRecord,
  PermissionRecord,
  RolePermissionRecord,
  RoleRecord,
  UserRecord,
  UserRoleRecord,
  SmsVerificationRecord,
} from "../../shared/types.ts";
import type { LlmObservabilityStore } from "./llm-observability-store.ts";
import type { AiNovelConversationStore } from "./ai-novel-conversation-store.ts";
import type { FrogSleepBuddyCommandSlotKey } from "../../modules/frogsleep/buddy-growth/buddy-command-slot-keys.ts";
import type { FrogSleepBuddyInvitationDecisionSafetyKey } from "../../modules/frogsleep/buddy-growth/buddy-decision-safety-key.ts";

type MaybePromise<T> = T | Promise<T>;

export interface ManagedStateSnapshot {
  apps: AppRecord[];
  roles: RoleRecord[];
  rolePermissions: RolePermissionRecord[];
  appConfigs: AppConfigRecord[];
}

/**
 * ApplicationDatabase is the production-facing database contract.
 * Production implementations should talk to PostgreSQL directly.
 * Test doubles may keep in-memory state, but business code should only use this API.
 */
export abstract class ApplicationDatabase {
  abstract getBuddySupportRepository(): BuddySupportRepository;
  abstract readonly llmObservabilityStore: LlmObservabilityStore;
  abstract readonly aiNovelConversationStore: AiNovelConversationStore;
  abstract getSleepGuestStore(): SleepGuestStore;
  abstract getPersonalSyncRepository(): PersonalSyncRepository;
  abstract getFrogSleepAdminStore(): FrogSleepAdminStore;
  abstract withExclusiveSession<T>(fn: () => Promise<T> | T): Promise<T>;
  abstract withNewUserTransaction<T>(userId: string, fn: () => Promise<T> | T): Promise<T>;
  abstract withAppUserDataTransaction<T>(appId: string, userId: string, fn: () => Promise<T> | T): Promise<T>;
  abstract withFrogSleepBuddyCommandTransaction<T>(
    slotKeys: FrogSleepBuddyCommandSlotKey[],
    fn: () => Promise<T> | T,
  ): Promise<T>;
  abstract withFrogSleepBuddyInvitationDecisionSafetyTransaction<T>(
    key: FrogSleepBuddyInvitationDecisionSafetyKey,
    fn: () => Promise<T> | T,
  ): Promise<T>;
  abstract close(): Promise<void>;
  abstract exportManagedState(): MaybePromise<ManagedStateSnapshot>;

  abstract listApps(): MaybePromise<AppRecord[]>;
  abstract listAppIds(): MaybePromise<string[]>;
  abstract findApp(appId: string): MaybePromise<AppRecord | undefined>;
  abstract findAppByApiDomain(hostname: string): MaybePromise<AppRecord | undefined>;
  abstract insertApp(record: AppRecord): MaybePromise<void>;
  abstract updateAppNames(appId: string, name: string, nameI18n: AppNameI18n): MaybePromise<void>;
  abstract deleteApp(appId: string): MaybePromise<void>;

  abstract listAppUsers(appId?: string): MaybePromise<AppUserRecord[]>;
  abstract findAppUser(appId: string, userId: string): MaybePromise<AppUserRecord | undefined>;
  abstract insertAppUser(record: AppUserRecord): MaybePromise<void>;
  abstract updateAppUserStatus(
    appId: string,
    userId: string,
    status: AppUserRecord["status"],
  ): MaybePromise<AppUserRecord | undefined>;
  abstract finalizeAppUserAccountRegion(
    appId: string,
    userId: string,
    accountRegion: Exclude<AppUserRecord["accountRegion"], "UNKNOWN">,
  ): MaybePromise<AppUserRecord | undefined>;
  abstract deleteAppUserRuntimeData(appId: string, userId: string): MaybePromise<void>;

  abstract findBodyLogProfile(...args: Parameters<ApplicationBodyLogDatabasePort['findBodyLogProfile']>): ReturnType<ApplicationBodyLogDatabasePort['findBodyLogProfile']>;
  abstract listBodyLogProfilesByIds(...args: Parameters<ApplicationBodyLogDatabasePort['listBodyLogProfilesByIds']>): ReturnType<ApplicationBodyLogDatabasePort['listBodyLogProfilesByIds']>;
  abstract upsertBodyLogProfile(...args: Parameters<ApplicationBodyLogDatabasePort['upsertBodyLogProfile']>): ReturnType<ApplicationBodyLogDatabasePort['upsertBodyLogProfile']>;
  abstract listBodyLogFriendRequests(...args: Parameters<ApplicationBodyLogDatabasePort['listBodyLogFriendRequests']>): ReturnType<ApplicationBodyLogDatabasePort['listBodyLogFriendRequests']>;
  abstract upsertBodyLogFriendRequest(...args: Parameters<ApplicationBodyLogDatabasePort['upsertBodyLogFriendRequest']>): ReturnType<ApplicationBodyLogDatabasePort['upsertBodyLogFriendRequest']>;
  abstract listBodyLogFriendships(...args: Parameters<ApplicationBodyLogDatabasePort['listBodyLogFriendships']>): ReturnType<ApplicationBodyLogDatabasePort['listBodyLogFriendships']>;
  abstract insertBodyLogFriendship(...args: Parameters<ApplicationBodyLogDatabasePort['insertBodyLogFriendship']>): ReturnType<ApplicationBodyLogDatabasePort['insertBodyLogFriendship']>;
  abstract deleteBodyLogFriendship(...args: Parameters<ApplicationBodyLogDatabasePort['deleteBodyLogFriendship']>): ReturnType<ApplicationBodyLogDatabasePort['deleteBodyLogFriendship']>;
  abstract listBodyLogBlocks(...args: Parameters<ApplicationBodyLogDatabasePort['listBodyLogBlocks']>): ReturnType<ApplicationBodyLogDatabasePort['listBodyLogBlocks']>;
  abstract insertBodyLogBlock(...args: Parameters<ApplicationBodyLogDatabasePort['insertBodyLogBlock']>): ReturnType<ApplicationBodyLogDatabasePort['insertBodyLogBlock']>;
  abstract deleteBodyLogBlock(...args: Parameters<ApplicationBodyLogDatabasePort['deleteBodyLogBlock']>): ReturnType<ApplicationBodyLogDatabasePort['deleteBodyLogBlock']>;
  abstract insertBodyLogReport(...args: Parameters<ApplicationBodyLogDatabasePort['insertBodyLogReport']>): ReturnType<ApplicationBodyLogDatabasePort['insertBodyLogReport']>;
  abstract listBodyLogReports(...args: Parameters<ApplicationBodyLogDatabasePort['listBodyLogReports']>): ReturnType<ApplicationBodyLogDatabasePort['listBodyLogReports']>;
  abstract findBodyLogWeeklyGoalSnapshot(...args: Parameters<ApplicationBodyLogDatabasePort['findBodyLogWeeklyGoalSnapshot']>): ReturnType<ApplicationBodyLogDatabasePort['findBodyLogWeeklyGoalSnapshot']>;
  abstract upsertBodyLogWeeklyGoalSnapshot(...args: Parameters<ApplicationBodyLogDatabasePort['upsertBodyLogWeeklyGoalSnapshot']>): ReturnType<ApplicationBodyLogDatabasePort['upsertBodyLogWeeklyGoalSnapshot']>;
  abstract listBodyLogDailyAggregates(...args: Parameters<ApplicationBodyLogDatabasePort['listBodyLogDailyAggregates']>): ReturnType<ApplicationBodyLogDatabasePort['listBodyLogDailyAggregates']>;
  abstract upsertBodyLogDailyAggregate(...args: Parameters<ApplicationBodyLogDatabasePort['upsertBodyLogDailyAggregate']>): ReturnType<ApplicationBodyLogDatabasePort['upsertBodyLogDailyAggregate']>;
  abstract findBodyLogLeaderboardEntry(...args: Parameters<ApplicationBodyLogDatabasePort['findBodyLogLeaderboardEntry']>): ReturnType<ApplicationBodyLogDatabasePort['findBodyLogLeaderboardEntry']>;
  abstract upsertBodyLogLeaderboardEntry(...args: Parameters<ApplicationBodyLogDatabasePort['upsertBodyLogLeaderboardEntry']>): ReturnType<ApplicationBodyLogDatabasePort['upsertBodyLogLeaderboardEntry']>;
  abstract listBodyLogLeaderboardEntries(...args: Parameters<ApplicationBodyLogDatabasePort['listBodyLogLeaderboardEntries']>): ReturnType<ApplicationBodyLogDatabasePort['listBodyLogLeaderboardEntries']>;
  abstract findBodyLogInvitationByTokenHash(...args: Parameters<ApplicationBodyLogDatabasePort['findBodyLogInvitationByTokenHash']>): ReturnType<ApplicationBodyLogDatabasePort['findBodyLogInvitationByTokenHash']>;
  abstract findBodyLogInvitationByCode(...args: Parameters<ApplicationBodyLogDatabasePort['findBodyLogInvitationByCode']>): ReturnType<ApplicationBodyLogDatabasePort['findBodyLogInvitationByCode']>;
  abstract updateBodyLogInvitation(...args: Parameters<ApplicationBodyLogDatabasePort['updateBodyLogInvitation']>): ReturnType<ApplicationBodyLogDatabasePort['updateBodyLogInvitation']>;
  abstract insertBodyLogInvitation(...args: Parameters<ApplicationBodyLogDatabasePort['insertBodyLogInvitation']>): ReturnType<ApplicationBodyLogDatabasePort['insertBodyLogInvitation']>;
  abstract listBodyLogInvitations(...args: Parameters<ApplicationBodyLogDatabasePort['listBodyLogInvitations']>): ReturnType<ApplicationBodyLogDatabasePort['listBodyLogInvitations']>;
  abstract insertBodyLogInvitationAttribution(...args: Parameters<ApplicationBodyLogDatabasePort['insertBodyLogInvitationAttribution']>): ReturnType<ApplicationBodyLogDatabasePort['insertBodyLogInvitationAttribution']>;
  abstract updateBodyLogInvitationAttribution(...args: Parameters<ApplicationBodyLogDatabasePort['updateBodyLogInvitationAttribution']>): ReturnType<ApplicationBodyLogDatabasePort['updateBodyLogInvitationAttribution']>;
  abstract listBodyLogInvitationAttributions(...args: Parameters<ApplicationBodyLogDatabasePort['listBodyLogInvitationAttributions']>): ReturnType<ApplicationBodyLogDatabasePort['listBodyLogInvitationAttributions']>;
  abstract insertBodyLogChallenge(...args: Parameters<ApplicationBodyLogDatabasePort['insertBodyLogChallenge']>): ReturnType<ApplicationBodyLogDatabasePort['insertBodyLogChallenge']>;
  abstract updateBodyLogChallenge(...args: Parameters<ApplicationBodyLogDatabasePort['updateBodyLogChallenge']>): ReturnType<ApplicationBodyLogDatabasePort['updateBodyLogChallenge']>;
  abstract listBodyLogChallenges(...args: Parameters<ApplicationBodyLogDatabasePort['listBodyLogChallenges']>): ReturnType<ApplicationBodyLogDatabasePort['listBodyLogChallenges']>;
  abstract insertBodyLogChallengeMembers(...args: Parameters<ApplicationBodyLogDatabasePort['insertBodyLogChallengeMembers']>): ReturnType<ApplicationBodyLogDatabasePort['insertBodyLogChallengeMembers']>;
  abstract updateBodyLogChallengeMember(...args: Parameters<ApplicationBodyLogDatabasePort['updateBodyLogChallengeMember']>): ReturnType<ApplicationBodyLogDatabasePort['updateBodyLogChallengeMember']>;
  abstract listBodyLogChallengeMembers(...args: Parameters<ApplicationBodyLogDatabasePort['listBodyLogChallengeMembers']>): ReturnType<ApplicationBodyLogDatabasePort['listBodyLogChallengeMembers']>;
  abstract listRoles(appId?: string): MaybePromise<RoleRecord[]>;
  abstract findRole(appId: string, roleCode: string): MaybePromise<RoleRecord | undefined>;
  abstract insertRoles(records: RoleRecord[]): MaybePromise<void>;

  abstract listPermissions(): MaybePromise<PermissionRecord[]>;
  abstract insertRolePermissions(records: RolePermissionRecord[]): MaybePromise<void>;
  abstract findUserRole(appId: string, userId: string, roleId: string): MaybePromise<UserRoleRecord | undefined>;
  abstract insertUserRole(record: UserRoleRecord): MaybePromise<void>;
  abstract getPermissionCodes(appId: string, userId: string): MaybePromise<string[]>;

  abstract findUserById(userId: string): MaybePromise<UserRecord | undefined>;
  abstract findUserByAccount(account: string): MaybePromise<UserRecord | undefined>;
  abstract findUserByPhone(phone: string): MaybePromise<UserRecord | undefined>;
  abstract insertUser(record: UserRecord): MaybePromise<void>;
  abstract updateUserEmail(userId: string, email: string): MaybePromise<void>;
  abstract updateUserPassword(userId: string, passwordHash: string, passwordAlgo: string): MaybePromise<void>;

  abstract insertAuditLog(record: AuditLogRecord): MaybePromise<void>;

  abstract listAppConfigs(appId?: string): MaybePromise<AppConfigRecord[]>;
  abstract findAppConfig(appId: string, configKey: string): MaybePromise<AppConfigRecord | undefined>;
  abstract upsertAppConfig(record: AppConfigRecord): MaybePromise<AppConfigRecord>;
  abstract deleteAppConfigsByApp(appId: string): MaybePromise<void>;

  abstract insertAnalyticsEvents(records: AnalyticsEventRecord[]): MaybePromise<void>;
  abstract listAnalyticsEvents(appId: string): MaybePromise<AnalyticsEventRecord[]>;

  abstract insertFile(record: FileRecord): MaybePromise<void>;
  abstract findFileByOwnerAndStorageKey(
    appId: string,
    ownerUserId: string,
    storageKey: string,
  ): MaybePromise<FileRecord | undefined>;
  abstract findFileByAppAndStorageKey(appId: string, storageKey: string): MaybePromise<FileRecord | undefined>;
  abstract confirmFile(fileId: string, mimeType: string, sizeBytes: number): MaybePromise<FileRecord | undefined>;

  abstract listSmsVerificationRecords(appId?: string): MaybePromise<SmsVerificationRecord[]>;
  abstract findSmsVerificationRecord(recordId: string): MaybePromise<SmsVerificationRecord | undefined>;
  abstract insertSmsVerificationRecord(record: SmsVerificationRecord): MaybePromise<void>;
  abstract updateSmsVerificationRecord(
    recordId: string,
    patch: Partial<
      Pick<
        SmsVerificationRecord,
        "status" | "providerRequestId" | "providerSerialNo" | "providerMessage" | "consumedAt" | "failedAt" | "revealCount" | "lastRevealedAt" | "updatedAt"
      >
    >,
  ): MaybePromise<void>;

  abstract deleteSmsVerificationRecordsCreatedBefore(cutoffIso: string): MaybePromise<number>;

  abstract insertEmailDeliveryEvent(record: EmailDeliveryEventRecord): MaybePromise<void>;
  abstract listEmailDeliveryEvents(filter?: {
    event?: EmailDeliveryEventRecord["event"];
    email?: string;
    limit?: number;
  }): MaybePromise<EmailDeliveryEventRecord[]>;

  abstract withFrogSleepNotificationLock<T>(key: string, operation: () => Promise<T> | T): Promise<T>;
  abstract insertNotificationJob(record: NotificationJobRecord): MaybePromise<void>;
  abstract findNotificationJob(jobId: string): MaybePromise<NotificationJobRecord | undefined>;
  abstract updateNotificationJob(
    jobId: string,
    patch: Partial<Pick<NotificationJobRecord, "status" | "retryCount" | "payload">>,
  ): MaybePromise<NotificationJobRecord | undefined>;

  abstract upsertFrogSleepDevice(record: FrogSleepDeviceRecord): MaybePromise<FrogSleepDeviceRecord>;
  abstract deleteFrogSleepDevice(appId: string, userId: string, deviceId: string): MaybePromise<FrogSleepDeviceRecord | undefined>;
  abstract listFrogSleepDevices(filter: {
    appId: string;
    userId?: string;
    pushEnabled?: boolean;
    includeDeleted?: boolean;
  }): MaybePromise<FrogSleepDeviceRecord[]>;

  abstract upsertFrogSleepFocusSession(record: FrogSleepEntityRecord): MaybePromise<FrogSleepFocusSessionWriteResult>;
  abstract insertFrogSleepEntity(record: FrogSleepEntityRecord): MaybePromise<void>;
  abstract findFrogSleepEntity(kind: FrogSleepEntityKind, appId: string, id: string): MaybePromise<FrogSleepEntityRecord | undefined>;
  abstract findFrogSleepPersonalRecord(kind: FrogSleepEntityKind, ownerUserId: string, clientId: string): MaybePromise<FrogSleepEntityRecord | undefined>;
  abstract findFrogSleepEntityByCode(kind: FrogSleepEntityKind, appId: string, code: string): MaybePromise<FrogSleepEntityRecord | undefined>;
  abstract findFrogSleepEntityByToken(kind: FrogSleepEntityKind, appId: string, token: string): MaybePromise<FrogSleepEntityRecord | undefined>;
  abstract listFrogSleepEntities(filter: FrogSleepEntityFilter): MaybePromise<FrogSleepEntityRecord[]>;
  abstract updateFrogSleepEntity(
    kind: FrogSleepEntityKind,
    appId: string,
    id: string,
    patch: Partial<Omit<FrogSleepEntityRecord, "id" | "kind" | "appId" | "createdAt">>,
  ): MaybePromise<FrogSleepEntityRecord | undefined>;
  abstract upsertFrogSleepBuddySharingGrant(record: FrogSleepBuddySharingGrantRecord): MaybePromise<FrogSleepBuddySharingGrantRecord>;
  abstract listFrogSleepBuddySharingGrants(appId: string, relationshipId: string): MaybePromise<FrogSleepBuddySharingGrantRecord[]>;
  abstract findFrogSleepBuddySharingGrant(appId: string, grantId: string): MaybePromise<FrogSleepBuddySharingGrantRecord | undefined>;
  abstract updateFrogSleepBuddySharingGrant(
    appId: string,
    grantId: string,
    expectedVersion: number,
    state: FrogSleepBuddySharingGrantRecord["state"],
  ): MaybePromise<FrogSleepBuddySharingGrantRecord | undefined>;
  abstract upsertFrogSleepBuddyInvitationBundle(record: FrogSleepBuddyInvitationBundleRecord): MaybePromise<FrogSleepBuddyInvitationBundleRecord>;
  abstract markFrogSleepBuddyInvitationRead(appId: string, bundleId: string, userId: string): MaybePromise<FrogSleepBuddyInvitationBundleRecord | undefined>;
  abstract findFrogSleepBuddyInvitationBundle(appId: string, bundleId: string): MaybePromise<FrogSleepBuddyInvitationBundleRecord | undefined>;
  abstract listFrogSleepBuddyInvitationBundles(input: {
    appId: string; userId: string; direction: "incoming" | "outgoing";
    recipientEmailHash?: string; recipientEmail?: string;
  }): MaybePromise<FrogSleepBuddyInvitationBundleRecord[]>;
  abstract findFrogSleepBuddyInvitationBundleByCode(
    appId: string,
    code: string,
  ): MaybePromise<FrogSleepBuddyInvitationBundleRecord | undefined>;
  abstract findFrogSleepBuddyInvitationBundleByToken(
    appId: string,
    token: string,
  ): MaybePromise<FrogSleepBuddyInvitationBundleRecord | undefined>;
  abstract enqueueFrogSleepBuddyInvitationEmailDelivery(
    record: FrogSleepBuddyInvitationEmailDeliveryRecord,
  ): MaybePromise<FrogSleepBuddyInvitationEmailDeliveryRecord>;
  abstract findFrogSleepBuddyInvitationEmailDelivery(
    appId: string,
    invitationId: string,
  ): MaybePromise<FrogSleepBuddyInvitationEmailDeliveryRecord | undefined>;
  abstract findFrogSleepBuddyInvitationEmailDeliveryByProviderMessageId(
    providerMessageId: string,
  ): MaybePromise<FrogSleepBuddyInvitationEmailDeliveryRecord | undefined>;
  abstract listFrogSleepBuddyInvitationEmailDeliveries(filter?: {
    invitationId?: string;
    status?: FrogSleepBuddyInvitationEmailDeliveryRecord["status"];
    limit?: number;
  }): MaybePromise<FrogSleepBuddyInvitationEmailDeliveryRecord[]>;
  abstract claimReadyFrogSleepBuddyInvitationEmailDeliveries(
    nowIso: string,
    limit: number,
  ): MaybePromise<FrogSleepBuddyInvitationEmailDeliveryRecord[]>;
  abstract updateFrogSleepBuddyInvitationEmailDelivery(
    id: string,
    patch: Partial<Omit<FrogSleepBuddyInvitationEmailDeliveryRecord, "id" | "appId" | "invitationId" | "createdAt">>,
  ): MaybePromise<FrogSleepBuddyInvitationEmailDeliveryRecord | undefined>;
  abstract insertFrogSleepBuddyInvitationEmailAttempt(
    record: FrogSleepBuddyInvitationEmailAttemptRecord,
  ): MaybePromise<FrogSleepBuddyInvitationEmailAttemptRecord>;
  abstract listFrogSleepBuddyInvitationEmailAttempts(
    appId: string,
    deliveryId: string,
  ): MaybePromise<FrogSleepBuddyInvitationEmailAttemptRecord[]>;
  lockFrogSleepBuddyDomainSlots(_keys: FrogSleepBuddyCommandSlotKey[]): MaybePromise<void> {}
  lockFrogSleepBuddyInvitationBundle(_appId: string, _invitationId: string): MaybePromise<void> {}
  abstract upsertFrogSleepBuddyInvitationDomainDecision(
    record: FrogSleepBuddyInvitationDomainDecisionRecord,
  ): MaybePromise<FrogSleepBuddyInvitationDomainDecisionRecord>;
  abstract findFrogSleepBuddyInvitationDomainDecision(
    appId: string,
    invitationId: string,
    domain: FrogSleepBuddyInvitationDomainDecisionRecord["domain"],
  ): MaybePromise<FrogSleepBuddyInvitationDomainDecisionRecord | undefined>;
  abstract listFrogSleepBuddyInvitationDomainDecisions(
    appId: string,
    invitationId: string,
  ): MaybePromise<FrogSleepBuddyInvitationDomainDecisionRecord[]>;
  abstract compareAndUpdateFrogSleepBuddyInvitationDomainDecision(input: {
    appId: string; invitationId: string; domain: FrogSleepBuddyInvitationDomainDecisionRecord["domain"];
    expectedVersion: number; status: FrogSleepBuddyInvitationDomainDecisionRecord["status"];
    decidedByUserId: string; decidedAt: string; idempotencyKeyHash: string; relationshipId?: string; terminalReason?: string; updatedAt: string;
  }): MaybePromise<FrogSleepBuddyInvitationDomainDecisionRecord | undefined>;
  abstract ensureFrogSleepBuddyDomainSlot(input: {
    appId: string; userId: string; domain: FrogSleepBuddyDomainSlotRecord["domain"]; now: string;
  }): MaybePromise<FrogSleepBuddyDomainSlotRecord>;
  abstract findFrogSleepBuddyDomainSlot(
    appId: string, userId: string, domain: FrogSleepBuddyDomainSlotRecord["domain"],
  ): MaybePromise<FrogSleepBuddyDomainSlotRecord | undefined>;
  abstract listFrogSleepBuddyDomainSlots(
    appId: string, userId: string,
  ): MaybePromise<FrogSleepBuddyDomainSlotRecord[]>;
  abstract compareAndUpdateFrogSleepBuddyDomainSlot(input: {
    appId: string; userId: string; domain: FrogSleepBuddyDomainSlotRecord["domain"]; expectedVersion: number;
    state: FrogSleepBuddyDomainSlotRecord["state"]; relationshipId?: string; updatedAt: string;
  }): MaybePromise<FrogSleepBuddyDomainSlotRecord | undefined>;
  abstract insertFrogSleepBuddyDomainRelationship(
    record: FrogSleepBuddyDomainRelationshipRecord,
  ): MaybePromise<FrogSleepBuddyDomainRelationshipRecord>;
  abstract findFrogSleepBuddyDomainRelationship(
    appId: string, relationshipId: string,
  ): MaybePromise<FrogSleepBuddyDomainRelationshipRecord | undefined>;
  abstract listCurrentFrogSleepBuddyDomainRelationships(
    appId: string, userId: string, domain: FrogSleepBuddyDomainRelationshipRecord["domain"], includeRevoked?: boolean,
  ): MaybePromise<FrogSleepBuddyDomainRelationshipRecord[]>;
  abstract compareAndUpdateFrogSleepBuddyDomainRelationship(input: {
    appId: string; id: string; expectedVersion: number;
    status: FrogSleepBuddyDomainRelationshipRecord["status"];
    pausedByUserIds: string[]; revokedAt?: string; updatedAt: string;
  }): MaybePromise<FrogSleepBuddyDomainRelationshipRecord | undefined>;
  abstract insertFrogSleepBuddyGroup(
    record: FrogSleepBuddyGroupRecord,
  ): MaybePromise<FrogSleepBuddyGroupRecord>;
  abstract findFrogSleepBuddyGroup(
    appId: string, groupId: string,
  ): MaybePromise<FrogSleepBuddyGroupRecord | undefined>;
  abstract listFrogSleepBuddyGroupsForUser(
    appId: string, userId: string,
  ): MaybePromise<FrogSleepBuddyGroupRecord[]>;
  abstract listFrogSleepBuddyGroupsForOwner(
    appId: string, ownerUserId: string,
  ): MaybePromise<FrogSleepBuddyGroupRecord[]>;
  abstract compareAndUpdateFrogSleepBuddyGroup(input: {
    appId: string; id: string; expectedVersion: number;
    status: FrogSleepBuddyGroupRecord["status"]; memberCount: number;
    sharingBaseline: string[]; dissolvedAt?: string; updatedAt: string;
    groupName?: string; groupDescription?: string; groupDescriptionSpecified?: boolean;
  }): MaybePromise<FrogSleepBuddyGroupRecord | undefined>;
  abstract insertFrogSleepBuddyGroupMember(
    record: FrogSleepBuddyGroupMemberRecord,
  ): MaybePromise<FrogSleepBuddyGroupMemberRecord>;
  abstract findFrogSleepBuddyGroupMember(
    appId: string, groupId: string, userId: string,
  ): MaybePromise<FrogSleepBuddyGroupMemberRecord | undefined>;
  abstract listFrogSleepBuddyGroupMembers(
    appId: string, groupId: string,
  ): MaybePromise<FrogSleepBuddyGroupMemberRecord[]>;
  abstract compareAndUpdateFrogSleepBuddyGroupMember(input: {
    appId: string; groupId: string; userId: string; expectedVersion: number;
    role: FrogSleepBuddyGroupMemberRecord["role"];
    status: FrogSleepBuddyGroupMemberRecord["status"];
    leftAt?: string; updatedAt: string;
  }): MaybePromise<FrogSleepBuddyGroupMemberRecord | undefined>;
  abstract insertFrogSleepBuddyGroupInvitation(
    record: FrogSleepBuddyGroupInvitationRecord,
  ): MaybePromise<FrogSleepBuddyGroupInvitationRecord>;
  abstract findFrogSleepBuddyGroupInvitation(
    appId: string, invitationId: string,
  ): MaybePromise<FrogSleepBuddyGroupInvitationRecord | undefined>;
  abstract listFrogSleepBuddyGroupInvitations(
    appId: string, groupId: string,
  ): MaybePromise<FrogSleepBuddyGroupInvitationRecord[]>;
  abstract compareAndUpdateFrogSleepBuddyGroupInvitation(input: {
    appId: string; invitationId: string; expectedVersion: number;
    status: FrogSleepBuddyGroupInvitationRecord["status"];
    respondedAt?: string; updatedAt: string;
  }): MaybePromise<FrogSleepBuddyGroupInvitationRecord | undefined>;
  abstract upsertFrogSleepBuddyInvitationReceiptAttempt(
    record: FrogSleepBuddyInvitationReceiptAttemptRecord,
  ): MaybePromise<FrogSleepBuddyInvitationReceiptAttemptRecord>;
  abstract findFrogSleepBuddyInvitationReceiptAttempt(
    appId: string, inviterUserId: string, recipientIdentityHash: string, domainsFingerprint: string,
  ): MaybePromise<FrogSleepBuddyInvitationReceiptAttemptRecord | undefined>;
  abstract findFrogSleepBuddyInvitationReceiptAttemptById(
    appId: string, inviterUserId: string, receiptId: string,
  ): MaybePromise<FrogSleepBuddyInvitationReceiptAttemptRecord | undefined>;
  abstract enqueueFrogSleepBuddyNotificationOutbox(record: FrogSleepBuddyNotificationOutboxRecord): MaybePromise<FrogSleepBuddyNotificationOutboxRecord>;
  abstract listReadyFrogSleepBuddyNotificationOutbox(nowIso: string, limit: number): MaybePromise<FrogSleepBuddyNotificationOutboxRecord[]>;
  abstract updateFrogSleepBuddyNotificationOutbox(id: string, patch: Partial<Pick<FrogSleepBuddyNotificationOutboxRecord,
    "status" | "attemptCount" | "processedAt" | "lastErrorCode" | "updatedAt">>): MaybePromise<FrogSleepBuddyNotificationOutboxRecord | undefined>;
  abstract upsertFrogSleepBuddyNotification(record: FrogSleepBuddyNotificationRecord): MaybePromise<FrogSleepBuddyNotificationRecord>;
  abstract findFrogSleepBuddyNotification(appId: string, recipientUserId: string, notificationId: string): MaybePromise<FrogSleepBuddyNotificationRecord | undefined>;
  abstract listFrogSleepBuddyNotifications(input: { appId: string; recipientUserId: string; limit: number; cursor?: string }): MaybePromise<{ items: FrogSleepBuddyNotificationRecord[]; nextCursor?: string }>;
  abstract countUnreadFrogSleepBuddyNotifications(appId: string, recipientUserId: string): MaybePromise<number>;
  abstract markFrogSleepBuddyNotificationRead(appId: string, recipientUserId: string, notificationId: string, readAt: string): MaybePromise<FrogSleepBuddyNotificationRecord | undefined>;
  abstract markAllFrogSleepBuddyNotificationsRead(appId: string, recipientUserId: string, readAt: string): MaybePromise<number>;
  abstract insertFrogSleepBuddyNotificationDelivery(record: FrogSleepBuddyNotificationDeliveryRecord): MaybePromise<FrogSleepBuddyNotificationDeliveryRecord>;

  abstract insertFailedEvent(record: FailedEventRecord): MaybePromise<void>;
  abstract listFailedEvents(appId?: string): MaybePromise<FailedEventRecord[]>;
  abstract deleteFailedEvent(eventId: string): MaybePromise<void>;
  abstract updateFailedEvent(
    eventId: string,
    patch: Pick<FailedEventRecord, "retryCount" | "errorMessage" | "nextRetryAt">,
  ): MaybePromise<void>;

  abstract listClientLogUploadTasks(appId?: string): MaybePromise<ClientLogUploadTaskRecord[]>;
  abstract findClientLogUploadTask(taskId: string): MaybePromise<ClientLogUploadTaskRecord | undefined>;
  abstract insertClientLogUploadTask(record: ClientLogUploadTaskRecord): MaybePromise<void>;
  abstract updateClientLogUploadTask(
    taskId: string,
    patch: Partial<
      Pick<
        ClientLogUploadTaskRecord,
        "status" | "did" | "claimToken" | "claimExpireAt" | "uploadedAt" | "uploadedFileName" | "uploadedFilePath" | "uploadedFileSizeBytes" | "uploadedLineCount" | "failedAt" | "failureReason"
      >
    >,
  ): MaybePromise<void>;
  abstract insertClientLogUpload(record: ClientLogUploadRecord): MaybePromise<void>;
  abstract insertClientLogLines(records: ClientLogLineRecord[]): MaybePromise<void>;

  abstract insertContentSafetyCheckRecord(record: ContentSafetyCheckRecord): MaybePromise<void>;
  abstract listContentSafetyCheckRecords(filter?: {
    createdAtFromIso?: string;
    createdAtToIso?: string;
    appId?: string;
    source?: ContentSafetyCheckRecord["source"];
    method?: ContentSafetyCheckRecord["method"];
    taskType?: string;
    decision?: ContentSafetyCheckRecord["decision"];
    limit?: number;
  }): MaybePromise<ContentSafetyCheckRecord[]>;
  abstract deleteContentSafetyCheckRecordsCreatedBefore(cutoffIso: string): MaybePromise<number>;

  abstract insertFeedback(
    record: FeedbackRecord,
    attachments: FeedbackAttachmentRecord[],
  ): MaybePromise<void>;
  abstract listFeedbackRecords(filter: {
    appId: string;
    userId?: string;
    ipHash?: string;
    status?: FeedbackRecord["status"];
    createdAtFromIso?: string;
    limit?: number;
  }): MaybePromise<FeedbackRecord[]>;
  abstract updateFeedbackStatus(
    appId: string,
    feedbackId: string,
    status: FeedbackRecord["status"],
  ): MaybePromise<FeedbackRecord | undefined>;
  abstract listFeedbackAttachments(feedbackIds: string[]): MaybePromise<FeedbackAttachmentRecord[]>;
  abstract findFeedbackAttachment(
    appId: string,
    feedbackId: string,
    attachmentId: string,
  ): MaybePromise<FeedbackAttachmentRecord | undefined>;

  abstract insertAiOutputReport(
    record: AiOutputReportRecord,
  ): MaybePromise<void>;
  abstract findAiOutputReportBySubmission(
    appId: string,
    userId: string,
    submissionId: string,
  ): MaybePromise<AiOutputReportRecord | undefined>;
  abstract findAiOutputReportById(
    appId: string,
    reportId: string,
  ): MaybePromise<AiOutputReportRecord | undefined>;
  abstract listAiOutputReports(filter: {
    appId: string;
    userId?: string;
    category?: AiOutputReportRecord["category"];
    status?: AiOutputReportRecord["status"];
    createdAtFromIso?: string;
    limit?: number;
  }): MaybePromise<AiOutputReportRecord[]>;
  abstract updateAiOutputReportStatus(
    appId: string,
    reportId: string,
    status: AiOutputReportRecord["status"],
    resolutionCode?: string,
    resolutionNote?: string,
  ): MaybePromise<AiOutputReportRecord | undefined>;
  abstract insertAiOutputReaction(
    record: AiOutputReactionRecord,
  ): MaybePromise<void>;
  abstract findAiOutputReactionBySubmission(
    appId: string,
    userId: string,
    submissionId: string,
  ): MaybePromise<AiOutputReactionRecord | undefined>;

  abstract upsertAiNovelStatisticsSnapshot(
    record: AiNovelStatisticsSnapshotRecord,
  ): MaybePromise<void>;
  abstract findAiNovelStatisticsSnapshot(
    appId: string,
    userId: string,
  ): MaybePromise<AiNovelStatisticsSnapshotRecord | undefined>;
  abstract replaceAiNovelDailyWritingStats(
    appId: string,
    userId: string,
    records: AiNovelDailyStatisticsRecord[],
    updatedAt: string,
  ): MaybePromise<void>;
  abstract incrementAiNovelDailyTokenUsage(
    appId: string,
    userId: string,
    date: string,
    tokens: number,
    updatedAt: string,
  ): MaybePromise<void>;
  abstract listAiNovelDailyStatistics(filter: {
    appId: string;
    userId: string;
    dateFrom?: string;
    dateTo?: string;
  }): MaybePromise<AiNovelDailyStatisticsRecord[]>;

  // ─── BodyLog 后台打卡管理 ───

  abstract getBodyLogCheckinDashboard(...args: Parameters<ApplicationBodyLogDatabasePort['getBodyLogCheckinDashboard']>): ReturnType<ApplicationBodyLogDatabasePort['getBodyLogCheckinDashboard']>;

  abstract listBodyLogCheckinUserDates(...args: Parameters<ApplicationBodyLogDatabasePort['listBodyLogCheckinUserDates']>): ReturnType<ApplicationBodyLogDatabasePort['listBodyLogCheckinUserDates']>;

  abstract searchBodyLogCheckinRecords(...args: Parameters<ApplicationBodyLogDatabasePort['searchBodyLogCheckinRecords']>): ReturnType<ApplicationBodyLogDatabasePort['searchBodyLogCheckinRecords']>;

  abstract listBodyLogGroupHealth(...args: Parameters<ApplicationBodyLogDatabasePort['listBodyLogGroupHealth']>): ReturnType<ApplicationBodyLogDatabasePort['listBodyLogGroupHealth']>;

  abstract listBodyLogGroupMemberContributions(...args: Parameters<ApplicationBodyLogDatabasePort['listBodyLogGroupMemberContributions']>): ReturnType<ApplicationBodyLogDatabasePort['listBodyLogGroupMemberContributions']>;

  abstract listBodyLogHabitUsage(...args: Parameters<ApplicationBodyLogDatabasePort['listBodyLogHabitUsage']>): ReturnType<ApplicationBodyLogDatabasePort['listBodyLogHabitUsage']>;

  abstract listBodyLogHabitTemplates(...args: Parameters<ApplicationBodyLogDatabasePort['listBodyLogHabitTemplates']>): ReturnType<ApplicationBodyLogDatabasePort['listBodyLogHabitTemplates']>;

  abstract findBodyLogHabitTemplate(...args: Parameters<ApplicationBodyLogDatabasePort['findBodyLogHabitTemplate']>): ReturnType<ApplicationBodyLogDatabasePort['findBodyLogHabitTemplate']>;

  abstract findBodyLogHabitTemplateByKey(...args: Parameters<ApplicationBodyLogDatabasePort['findBodyLogHabitTemplateByKey']>): ReturnType<ApplicationBodyLogDatabasePort['findBodyLogHabitTemplateByKey']>;

  abstract insertBodyLogHabitTemplate(...args: Parameters<ApplicationBodyLogDatabasePort['insertBodyLogHabitTemplate']>): ReturnType<ApplicationBodyLogDatabasePort['insertBodyLogHabitTemplate']>;

  abstract updateBodyLogHabitTemplate(...args: Parameters<ApplicationBodyLogDatabasePort['updateBodyLogHabitTemplate']>): ReturnType<ApplicationBodyLogDatabasePort['updateBodyLogHabitTemplate']>;

  abstract deleteBodyLogHabitTemplate(...args: Parameters<ApplicationBodyLogDatabasePort['deleteBodyLogHabitTemplate']>): ReturnType<ApplicationBodyLogDatabasePort['deleteBodyLogHabitTemplate']>;
}

export function buildManagedStateSnapshot(seed: DatabaseSeed = {}): ManagedStateSnapshot {
  return {
    apps: structuredClone(seed.apps ?? []),
    roles: structuredClone(seed.roles ?? []),
    rolePermissions: structuredClone(seed.rolePermissions ?? []),
    appConfigs: structuredClone(seed.appConfigs ?? []),
  };
}
