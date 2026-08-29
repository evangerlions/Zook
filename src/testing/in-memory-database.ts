import { AsyncLocalStorage } from "node:async_hooks";
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
  FrogSleepBuddyInvitationReceiptAttemptRecord,
  FrogSleepBuddyDomainSlotRecord,
  FrogSleepBuddyDomainRelationshipRecord,
  FrogSleepBuddyGroupRecord,
  FrogSleepBuddyGroupMemberRecord,
  FrogSleepBuddyGroupInvitationRecord,
  FrogSleepBuddyNotificationOutboxRecord,
  FrogSleepBuddyNotificationRecord,
  FrogSleepBuddyNotificationDeliveryRecord,
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
} from "../shared/types.ts";
import { assertValidFrogSleepBuddyDomainSlot } from "../modules/frogsleep/buddy-growth/buddy-domain-slot-validation.ts";
import {
  normalizeFrogSleepBuddyDomainRelationship,
  normalizeFrogSleepBuddyDomainRelationshipUpdate,
} from "../modules/frogsleep/buddy-growth/buddy-domain-relationship-validation.ts";
import {
  normalizeFrogSleepBuddyCommandSlotKeys,
  serializeFrogSleepBuddyCommandSlotKey,
  type FrogSleepBuddyCommandSlotKey,
} from "../modules/frogsleep/buddy-growth/buddy-command-slot-keys.ts";
import {
  normalizeFrogSleepBuddyInvitationDecisionSafetyKey,
  serializeFrogSleepBuddyInvitationDecisionSafetyKey,
  type FrogSleepBuddyInvitationDecisionSafetyKey,
} from "../modules/frogsleep/buddy-growth/buddy-decision-safety-key.ts";
import {
  ApplicationDatabase,
  buildManagedStateSnapshot,
  type ManagedStateSnapshot,
} from "../infrastructure/database/application-database.ts";
import { InMemoryAiNovelStatisticsStore } from "./in-memory-ai-novel-statistics-store.ts";
import { InMemoryLlmObservabilityStore } from "./in-memory-llm-observability-store.ts";
import { conflict } from "../shared/errors.ts";
import type { BodyLogProfileRecord } from "../modules/bodylog/bodylog-profile.types.ts";
import type {
  BodyLogBlockRecord,
  BodyLogFriendRequestRecord,
  BodyLogFriendshipRecord,
  BodyLogReportRecord,
} from "../modules/bodylog/bodylog-social.types.ts";
import type {
  BodyLogDailyAggregate,
  BodyLogLeaderboardEntryRecord,
  BodyLogWeeklyGoalSnapshot,
} from "../modules/bodylog/bodylog-scoring.types.ts";
import type {
  BodyLogInvitationAttributionRecord,
  BodyLogInvitationRecord,
} from "../modules/bodylog/bodylog-invitation.types.ts";
import type {
  BodyLogChallengeMemberRecord,
  BodyLogChallengeRecord,
} from "../modules/bodylog/bodylog-challenge.types.ts";

function normalizeListLimit(limit?: number): number {
  return Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit as number), 500)) : 100;
}

/**
 * InMemoryDatabase is a test-only database double.
 */
export class InMemoryDatabase extends ApplicationDatabase {
  private readonly exclusiveContext = new AsyncLocalStorage<boolean>();
  private exclusiveTail: Promise<void> = Promise.resolve();
  private readonly aiNovelStatistics: InMemoryAiNovelStatisticsStore;
  private readonly buddyCommandContext = new AsyncLocalStorage<Set<string>>();
  private buddyCommandTail: Promise<void> = Promise.resolve();
  private readonly buddyDecisionSafetyContext = new AsyncLocalStorage<string>();
  readonly llmObservabilityStore = new InMemoryLlmObservabilityStore();

  apps: AppRecord[];
  users: UserRecord[];
  appUsers: AppUserRecord[];
  roles: RoleRecord[];
  permissions: PermissionRecord[];
  rolePermissions: RolePermissionRecord[];
  userRoles: UserRoleRecord[];
  auditLogs: AuditLogRecord[];
  notificationJobs: NotificationJobRecord[];
  failedEvents: FailedEventRecord[];
  emailDeliveryEvents: EmailDeliveryEventRecord[];
  smsVerificationRecords: SmsVerificationRecord[];
  appConfigs: AppConfigRecord[];
  analyticsEvents: AnalyticsEventRecord[];
  files: FileRecord[];
  clientLogUploadTasks: ClientLogUploadTaskRecord[];
  clientLogUploads: ClientLogUploadRecord[];
  clientLogLines: ClientLogLineRecord[];
  contentSafetyCheckRecords: ContentSafetyCheckRecord[];
  feedbackRecords: FeedbackRecord[];
  feedbackAttachments: FeedbackAttachmentRecord[];
  frogSleepDevices: FrogSleepDeviceRecord[];
  frogSleepEntities: FrogSleepEntityRecord[];
  frogSleepBuddySharingGrants: FrogSleepBuddySharingGrantRecord[];
  frogSleepBuddyInvitationBundles: FrogSleepBuddyInvitationBundleRecord[];
  frogSleepBuddyInvitationEmailDeliveries: FrogSleepBuddyInvitationEmailDeliveryRecord[];
  frogSleepBuddyInvitationEmailAttempts: FrogSleepBuddyInvitationEmailAttemptRecord[];
  frogSleepBuddyInvitationDomainDecisions: FrogSleepBuddyInvitationDomainDecisionRecord[];
  frogSleepBuddyDomainSlots: FrogSleepBuddyDomainSlotRecord[];
  frogSleepBuddyDomainRelationships: FrogSleepBuddyDomainRelationshipRecord[];
  frogSleepBuddyInvitationReceiptAttempts: FrogSleepBuddyInvitationReceiptAttemptRecord[];
  frogSleepBuddyNotificationOutbox: FrogSleepBuddyNotificationOutboxRecord[];
  frogSleepBuddyNotifications: FrogSleepBuddyNotificationRecord[];
  frogSleepBuddyNotificationDeliveries: FrogSleepBuddyNotificationDeliveryRecord[];
  frogSleepBuddyGroups: FrogSleepBuddyGroupRecord[];
  frogSleepBuddyGroupMembers: FrogSleepBuddyGroupMemberRecord[];
  frogSleepBuddyGroupInvitations: FrogSleepBuddyGroupInvitationRecord[];
  aiOutputReportRecords: AiOutputReportRecord[];
  aiOutputReactionRecords: AiOutputReactionRecord[];
  bodyLogProfiles: BodyLogProfileRecord[];
  bodyLogFriendRequests: BodyLogFriendRequestRecord[];
  bodyLogFriendships: BodyLogFriendshipRecord[];
  bodyLogBlocks: BodyLogBlockRecord[];
  bodyLogReports: BodyLogReportRecord[];
  bodyLogWeeklyGoalSnapshots: BodyLogWeeklyGoalSnapshot[];
  bodyLogDailyAggregates: BodyLogDailyAggregate[];
  bodyLogLeaderboardEntries: BodyLogLeaderboardEntryRecord[];
  bodyLogInvitations: BodyLogInvitationRecord[];
  bodyLogInvitationAttributions: BodyLogInvitationAttributionRecord[];
  bodyLogChallenges: BodyLogChallengeRecord[];
  bodyLogChallengeMembers: BodyLogChallengeMemberRecord[];

  constructor(seed: DatabaseSeed = {}) {
    super();
    this.aiNovelStatistics = new InMemoryAiNovelStatisticsStore({
      snapshots: seed.aiNovelStatisticsSnapshots,
      dailyStatistics: seed.aiNovelDailyStatistics,
    });
    this.apps = structuredClone(seed.apps ?? []);
    this.users = structuredClone(seed.users ?? []);
    this.appUsers = structuredClone(seed.appUsers ?? []);
    this.roles = structuredClone(seed.roles ?? []);
    this.permissions = structuredClone(seed.permissions ?? []);
    this.rolePermissions = structuredClone(seed.rolePermissions ?? []);
    this.userRoles = structuredClone(seed.userRoles ?? []);
    this.auditLogs = structuredClone(seed.auditLogs ?? []);
    this.notificationJobs = structuredClone(seed.notificationJobs ?? []);
    this.failedEvents = structuredClone(seed.failedEvents ?? []);
    this.emailDeliveryEvents = [];
    this.smsVerificationRecords = structuredClone(seed.smsVerificationRecords ?? []);
    this.appConfigs = structuredClone(seed.appConfigs ?? []);
    this.analyticsEvents = structuredClone(seed.analyticsEvents ?? []);
    this.files = structuredClone(seed.files ?? []);
    this.clientLogUploadTasks = structuredClone(seed.clientLogUploadTasks ?? []);
    this.clientLogUploads = structuredClone(seed.clientLogUploads ?? []);
    this.clientLogLines = structuredClone(seed.clientLogLines ?? []);
    this.contentSafetyCheckRecords = structuredClone(seed.contentSafetyCheckRecords ?? []);
    this.feedbackRecords = structuredClone(seed.feedbackRecords ?? []);
    this.feedbackAttachments = structuredClone(seed.feedbackAttachments ?? []);
    this.frogSleepDevices = [];
    this.frogSleepEntities = [];
    this.frogSleepBuddySharingGrants = [];
    this.frogSleepBuddyInvitationBundles = [];
    this.frogSleepBuddyInvitationEmailDeliveries = [];
    this.frogSleepBuddyInvitationEmailAttempts = [];
    this.frogSleepBuddyInvitationDomainDecisions = structuredClone(seed.frogSleepBuddyInvitationDomainDecisions ?? []);
    this.frogSleepBuddyDomainSlots = structuredClone(seed.frogSleepBuddyDomainSlots ?? []);
    this.frogSleepBuddyDomainRelationships = structuredClone(seed.frogSleepBuddyDomainRelationships ?? []);
    this.frogSleepBuddyInvitationReceiptAttempts = structuredClone(seed.frogSleepBuddyInvitationReceiptAttempts ?? []);
    this.frogSleepBuddyNotificationOutbox = [];
    this.frogSleepBuddyNotifications = [];
    this.frogSleepBuddyGroups = structuredClone(seed.frogSleepBuddyGroups ?? []);
    this.frogSleepBuddyGroupMembers = structuredClone(seed.frogSleepBuddyGroupMembers ?? []);
    this.frogSleepBuddyGroupInvitations = structuredClone(seed.frogSleepBuddyGroupInvitations ?? []);
    this.frogSleepBuddyNotificationDeliveries = [];
    this.aiOutputReportRecords = structuredClone(seed.aiOutputReportRecords ?? []);
    this.aiOutputReactionRecords = structuredClone(seed.aiOutputReactionRecords ?? []);
    this.bodyLogProfiles = [];
    this.bodyLogFriendRequests = [];
    this.bodyLogFriendships = [];
    this.bodyLogBlocks = [];
    this.bodyLogReports = [];
    this.bodyLogWeeklyGoalSnapshots = [];
    this.bodyLogDailyAggregates = [];
    this.bodyLogLeaderboardEntries = [];
    this.bodyLogInvitations = [];
    this.bodyLogInvitationAttributions = [];
    this.bodyLogChallenges = [];
    this.bodyLogChallengeMembers = [];
  }

  async withExclusiveSession<T>(fn: () => Promise<T> | T): Promise<T> {
    if (this.exclusiveContext.getStore()) {
      return await fn();
    }

    let release = () => undefined;
    const previous = this.exclusiveTail;
    this.exclusiveTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    return await this.exclusiveContext.run(true, async () => {
      try {
        return await fn();
      } finally {
        release();
      }
    });
  }

  async withFrogSleepBuddyCommandTransaction<T>(
    slotKeys: FrogSleepBuddyCommandSlotKey[],
    fn: () => Promise<T> | T,
  ): Promise<T> {
    const normalized = normalizeFrogSleepBuddyCommandSlotKeys(slotKeys);
    const serialized = new Set(normalized.map(serializeFrogSleepBuddyCommandSlotKey));
    const outerKeys = this.buddyCommandContext.getStore();
    if (outerKeys) {
      if (normalized.some((key) => !outerKeys.has(serializeFrogSleepBuddyCommandSlotKey(key)))) {
        throw new Error("Nested transaction requested an additional buddy command transaction slot.");
      }
      return await fn();
    }
    return await this.runRootBuddyCommandTransaction(normalized, serialized, fn);
  }

  async withFrogSleepBuddyInvitationDecisionSafetyTransaction<T>(
    key: FrogSleepBuddyInvitationDecisionSafetyKey,
    fn: () => Promise<T> | T,
  ): Promise<T> {
    const serialized = serializeFrogSleepBuddyInvitationDecisionSafetyKey(
      normalizeFrogSleepBuddyInvitationDecisionSafetyKey(key),
    );
    const existing = this.buddyDecisionSafetyContext.getStore();
    if (existing) {
      if (existing !== serialized) throw new Error("Nested transaction requested an additional buddy decision safety key.");
      return await fn();
    }
    return await this.runRootBuddyDecisionSafetyTransaction(serialized, fn);
  }

  private async runRootBuddyCommandTransaction<T>(
    keys: FrogSleepBuddyCommandSlotKey[],
    serialized: Set<string>,
    fn: () => Promise<T> | T,
  ): Promise<T> {
    const release = this.reserveBuddyCommandTurn();
    await release.previous;
    const snapshot = this.snapshotCollections();
    try {
      return await this.buddyCommandContext.run(serialized, async () => {
        const now = new Date().toISOString();
        for (const key of keys) this.ensureFrogSleepBuddyDomainSlot({ ...key, now });
        return await fn();
      });
    } catch (error) {
      this.restoreCollections(snapshot);
      throw error;
    } finally {
      release.current();
    }
  }

  private async runRootBuddyDecisionSafetyTransaction<T>(serialized: string, fn: () => Promise<T> | T): Promise<T> {
    const release = this.reserveBuddyCommandTurn();
    await release.previous;
    const snapshot = this.snapshotCollections();
    try {
      return await this.buddyDecisionSafetyContext.run(serialized, async () => await fn());
    } catch (error) {
      this.restoreCollections(snapshot);
      throw error;
    } finally {
      release.current();
    }
  }

  private reserveBuddyCommandTurn(): { previous: Promise<void>; current: () => void } {
    const previous = this.buddyCommandTail;
    let current = () => undefined;
    this.buddyCommandTail = new Promise<void>((resolve) => { current = resolve; });
    return { previous, current };
  }

  private snapshotCollections(): Map<string, unknown[]> {
    const snapshot = new Map<string, unknown[]>();
    for (const [key, value] of Object.entries(this)) {
      if (Array.isArray(value)) snapshot.set(key, structuredClone(value));
    }
    return snapshot;
  }

  private restoreCollections(snapshot: Map<string, unknown[]>): void {
    for (const [key, value] of snapshot) {
      (this as unknown as Record<string, unknown>)[key] = value;
    }
  }

  async close(): Promise<void> {
    return undefined;
  }

  exportManagedState(): ManagedStateSnapshot {
    return {
      apps: structuredClone(this.apps),
      roles: structuredClone(this.roles),
      rolePermissions: structuredClone(this.rolePermissions),
      appConfigs: structuredClone(this.appConfigs),
    };
  }

  listApps(): AppRecord[] {
    return this.apps;
  }

  listAppIds(): string[] {
    return this.apps.map((item) => item.id);
  }

  findApp(appId: string): AppRecord | undefined {
    return this.apps.find((item) => item.id === appId || item.code === appId);
  }

  findAppByApiDomain(hostname: string): AppRecord | undefined {
    const normalized = hostname.trim().toLowerCase();
    return this.apps.find((item) => item.apiDomain?.toLowerCase() === normalized);
  }

  insertApp(record: AppRecord): void {
    this.apps.push(structuredClone(record));
  }

  updateAppNames(appId: string, name: string, nameI18n: AppNameI18n): void {
    const app = this.findApp(appId);
    if (!app) {
      return;
    }

    app.name = name;
    app.nameI18n = structuredClone(nameI18n);
  }

  deleteApp(appId: string): void {
    const roleIds = this.roles.filter((item) => item.appId === appId).map((item) => item.id);
    this.apps = this.apps.filter((item) => item.id !== appId);
    this.appUsers = this.appUsers.filter((item) => item.appId !== appId);
    this.roles = this.roles.filter((item) => item.appId !== appId);
    this.userRoles = this.userRoles.filter((item) => item.appId !== appId);
    this.rolePermissions = this.rolePermissions.filter((item) => !roleIds.includes(item.roleId));
    this.auditLogs = this.auditLogs.filter((item) => item.appId !== appId);
    this.notificationJobs = this.notificationJobs.filter((item) => item.appId !== appId);
    this.failedEvents = this.failedEvents.filter((item) => item.appId !== appId);
    this.smsVerificationRecords = this.smsVerificationRecords.filter((item) => item.appId !== appId);
    this.appConfigs = this.appConfigs.filter((item) => item.appId !== appId);
    this.analyticsEvents = this.analyticsEvents.filter((item) => item.appId !== appId);
    this.files = this.files.filter((item) => item.appId !== appId);
    this.clientLogUploadTasks = this.clientLogUploadTasks.filter((item) => item.appId !== appId);
    this.clientLogUploads = this.clientLogUploads.filter((item) => item.appId !== appId);
    this.clientLogLines = this.clientLogLines.filter((item) => item.appId !== appId);
    this.contentSafetyCheckRecords = this.contentSafetyCheckRecords.filter((item) => item.appId !== appId);
    this.feedbackRecords = this.feedbackRecords.filter((item) => item.appId !== appId);
    this.feedbackAttachments = this.feedbackAttachments.filter((item) => item.appId !== appId);
    this.frogSleepDevices = this.frogSleepDevices.filter((item) => item.appId !== appId);
    this.frogSleepEntities = this.frogSleepEntities.filter((item) => item.appId !== appId);
    this.frogSleepBuddySharingGrants = this.frogSleepBuddySharingGrants.filter((item) => item.appId !== appId);
    this.frogSleepBuddyInvitationBundles = this.frogSleepBuddyInvitationBundles.filter((item) => item.appId !== appId);
    this.frogSleepBuddyNotificationOutbox = this.frogSleepBuddyNotificationOutbox.filter((item) => item.appId !== appId);
    this.frogSleepBuddyNotifications = this.frogSleepBuddyNotifications.filter((item) => item.appId !== appId);
    this.frogSleepBuddyNotificationDeliveries = this.frogSleepBuddyNotificationDeliveries.filter((item) => item.appId !== appId);
    this.aiOutputReportRecords = this.aiOutputReportRecords.filter(
      (item) => item.appId !== appId,
    );
    this.aiOutputReactionRecords = this.aiOutputReactionRecords.filter(
      (item) => item.appId !== appId,
    );
    this.bodyLogProfiles = this.bodyLogProfiles.filter((item) => item.appId !== appId);
    this.bodyLogFriendRequests = this.bodyLogFriendRequests.filter((item) => item.appId !== appId);
    this.bodyLogFriendships = this.bodyLogFriendships.filter((item) => item.appId !== appId);
    this.bodyLogBlocks = this.bodyLogBlocks.filter((item) => item.appId !== appId);
    this.bodyLogReports = this.bodyLogReports.filter((item) => item.appId !== appId);
    this.bodyLogWeeklyGoalSnapshots = this.bodyLogWeeklyGoalSnapshots.filter((item) => item.appId !== appId);
    this.bodyLogDailyAggregates = this.bodyLogDailyAggregates.filter((item) => item.appId !== appId);
    this.bodyLogLeaderboardEntries = this.bodyLogLeaderboardEntries.filter((item) => item.appId !== appId);
    this.bodyLogInvitations = this.bodyLogInvitations.filter((item) => item.appId !== appId);
    this.bodyLogInvitationAttributions = this.bodyLogInvitationAttributions.filter((item) => item.appId !== appId);
    this.bodyLogChallenges = this.bodyLogChallenges.filter((item) => item.appId !== appId);
    this.bodyLogChallengeMembers = this.bodyLogChallengeMembers.filter((item) => item.appId !== appId);
    this.aiNovelStatistics.deleteApp(appId);
  }

  listAppUsers(appId?: string): AppUserRecord[] {
    return appId ? this.appUsers.filter((item) => item.appId === appId) : this.appUsers;
  }

  findAppUser(appId: string, userId: string): AppUserRecord | undefined {
    return this.appUsers.find((item) => item.appId === appId && item.userId === userId);
  }

  insertAppUser(record: AppUserRecord): void {
    this.appUsers.push(structuredClone(record));
  }

  updateAppUserStatus(
    appId: string,
    userId: string,
    status: AppUserRecord["status"],
  ): AppUserRecord | undefined {
    const membership = this.findAppUser(appId, userId);
    if (!membership) {
      return undefined;
    }
    membership.status = status;
    return structuredClone(membership);
  }

  finalizeAppUserAccountRegion(
    appId: string,
    userId: string,
    accountRegion: Exclude<AppUserRecord["accountRegion"], "UNKNOWN">,
  ): AppUserRecord | undefined {
    const membership = this.findAppUser(appId, userId);
    if (!membership || membership.accountRegion !== "UNKNOWN") {
      return undefined;
    }
    membership.accountRegion = accountRegion;
    return structuredClone(membership);
  }

  deleteAppUserRuntimeData(appId: string, userId: string): void {
    const uploadIds = this.clientLogUploads
      .filter((item) => item.appId === appId && item.userId === userId)
      .map((item) => item.id);
    const taskIds = this.clientLogUploadTasks
      .filter((item) => item.appId === appId && item.userId === userId)
      .map((item) => item.id);

    this.userRoles = this.userRoles.filter(
      (item) => item.appId !== appId || item.userId !== userId,
    );
    this.bodyLogProfiles = this.bodyLogProfiles.filter(
      (item) => item.appId !== appId || item.userId !== userId,
    );
    this.bodyLogFriendRequests = this.bodyLogFriendRequests.filter(
      (item) => item.appId !== appId ||
        (item.senderUserId !== userId && item.recipientUserId !== userId),
    );
    this.bodyLogFriendships = this.bodyLogFriendships.filter(
      (item) => item.appId !== appId ||
        (item.userId !== userId && item.friendUserId !== userId),
    );
    this.bodyLogBlocks = this.bodyLogBlocks.filter(
      (item) => item.appId !== appId ||
        (item.blockerUserId !== userId && item.blockedUserId !== userId),
    );
    this.bodyLogReports = this.bodyLogReports.filter(
      (item) => item.appId !== appId ||
        (item.reporterUserId !== userId && item.reportedUserId !== userId),
    );
    this.bodyLogWeeklyGoalSnapshots = this.bodyLogWeeklyGoalSnapshots.filter(
      (item) => item.appId !== appId || item.userId !== userId,
    );
    this.bodyLogDailyAggregates = this.bodyLogDailyAggregates.filter(
      (item) => item.appId !== appId || item.userId !== userId,
    );
    this.bodyLogLeaderboardEntries = this.bodyLogLeaderboardEntries.filter(
      (item) => item.appId !== appId || item.userId !== userId,
    );
    this.bodyLogInvitations = this.bodyLogInvitations.filter(
      (item) => item.appId !== appId || item.inviterUserId !== userId,
    );
    this.bodyLogInvitationAttributions = this.bodyLogInvitationAttributions.filter(
      (item) => item.appId !== appId ||
        (item.inviterUserId !== userId && item.inviteeUserId !== userId),
    );
    const removedChallengeIds = this.bodyLogChallengeMembers.filter(
      (item) => item.appId === appId && item.userId === userId,
    ).map((item) => item.challengeId);
    this.bodyLogChallenges = this.bodyLogChallenges.filter(
      (item) => item.appId !== appId ||
        (item.creatorUserId !== userId && !removedChallengeIds.includes(item.id)),
    );
    this.bodyLogChallengeMembers = this.bodyLogChallengeMembers.filter(
      (item) => item.appId !== appId || !removedChallengeIds.includes(item.challengeId),
    );
    this.notificationJobs = this.notificationJobs.filter(
      (item) => item.appId !== appId || item.recipientUserId !== userId,
    );
    this.analyticsEvents = this.analyticsEvents.filter(
      (item) => item.appId !== appId || item.userId !== userId,
    );
    this.files = this.files.filter(
      (item) => item.appId !== appId || item.ownerUserId !== userId,
    );
    this.clientLogLines = this.clientLogLines.filter(
      (item) =>
        (item.appId !== appId || item.userId !== userId) &&
        !uploadIds.includes(item.uploadId) &&
        !taskIds.includes(item.taskId),
    );
    this.clientLogUploads = this.clientLogUploads.filter(
      (item) => item.appId !== appId || item.userId !== userId,
    );
    this.clientLogUploadTasks = this.clientLogUploadTasks.filter(
      (item) => item.appId !== appId || item.userId !== userId,
    );
    this.contentSafetyCheckRecords = this.contentSafetyCheckRecords.filter(
      (item) => item.appId !== appId || item.userId !== userId,
    );
    const feedbackIds = this.feedbackRecords
      .filter((item) => item.appId === appId && item.userId === userId)
      .map((item) => item.id);
    this.feedbackRecords = this.feedbackRecords.filter(
      (item) => item.appId !== appId || item.userId !== userId,
    );
    this.feedbackAttachments = this.feedbackAttachments.filter(
      (item) => !feedbackIds.includes(item.feedbackId),
    );
    this.aiOutputReportRecords = this.aiOutputReportRecords.filter(
      (item) => item.appId !== appId || item.userId !== userId,
    );
    this.aiOutputReactionRecords = this.aiOutputReactionRecords.filter(
      (item) => item.appId !== appId || item.userId !== userId,
    );
    this.aiNovelStatistics.deleteUser(appId, userId);
    this.frogSleepDevices = this.frogSleepDevices.filter(
      (item) => item.appId !== appId || item.userId !== userId,
    );
    this.frogSleepEntities = this.frogSleepEntities.filter(
      (item) =>
        item.appId !== appId ||
        (item.ownerUserId !== userId && item.partnerUserId !== userId),
    );
    this.frogSleepBuddySharingGrants = this.frogSleepBuddySharingGrants.filter(
      (item) => item.appId !== appId || (item.grantorUserId !== userId && item.granteeUserId !== userId),
    );
    this.frogSleepBuddyInvitationBundles = this.frogSleepBuddyInvitationBundles.filter(
      (item) => item.appId !== appId || (item.inviterUserId !== userId && item.inviteeUserId !== userId),
    );
    this.frogSleepBuddyNotificationOutbox = this.frogSleepBuddyNotificationOutbox.filter(
      (item) => item.appId !== appId || item.recipientUserId !== userId,
    );
    const removedNotificationIds = this.frogSleepBuddyNotifications.filter((item) =>
      item.appId === appId && item.recipientUserId === userId).map((item) => item.id);
    this.frogSleepBuddyNotifications = this.frogSleepBuddyNotifications.filter(
      (item) => item.appId !== appId || item.recipientUserId !== userId,
    );
    this.frogSleepBuddyNotificationDeliveries = this.frogSleepBuddyNotificationDeliveries.filter(
      (item) => !removedNotificationIds.includes(item.notificationId),
    );
  }

  findBodyLogProfile(
    appId: string,
    userId: string,
  ): BodyLogProfileRecord | undefined {
    return structuredClone(
      this.bodyLogProfiles.find(
        (item) => item.appId === appId && item.userId === userId,
      ),
    );
  }

  upsertBodyLogProfile(record: BodyLogProfileRecord): BodyLogProfileRecord {
    const index = this.bodyLogProfiles.findIndex(
      (item) => item.appId === record.appId && item.userId === record.userId,
    );
    if (index >= 0) {
      this.bodyLogProfiles[index] = structuredClone(record);
    } else {
      this.bodyLogProfiles.push(structuredClone(record));
    }
    return structuredClone(record);
  }

  listBodyLogFriendRequests(appId: string): BodyLogFriendRequestRecord[] {
    return structuredClone(this.bodyLogFriendRequests.filter((item) => item.appId === appId));
  }

  upsertBodyLogFriendRequest(record: BodyLogFriendRequestRecord): BodyLogFriendRequestRecord {
    const index = this.bodyLogFriendRequests.findIndex((item) => item.id === record.id);
    if (index >= 0) this.bodyLogFriendRequests[index] = structuredClone(record);
    else this.bodyLogFriendRequests.push(structuredClone(record));
    return structuredClone(record);
  }

  listBodyLogFriendships(appId: string): BodyLogFriendshipRecord[] {
    return structuredClone(this.bodyLogFriendships.filter((item) => item.appId === appId));
  }

  insertBodyLogFriendship(record: BodyLogFriendshipRecord): void {
    const exists = this.bodyLogFriendships.some((item) =>
      item.appId === record.appId && item.userId === record.userId &&
      item.friendUserId === record.friendUserId);
    if (!exists) this.bodyLogFriendships.push(structuredClone(record));
  }

  deleteBodyLogFriendship(appId: string, userId: string, friendUserId: string): void {
    this.bodyLogFriendships = this.bodyLogFriendships.filter((item) =>
      item.appId !== appId ||
      !((item.userId === userId && item.friendUserId === friendUserId) ||
        (item.userId === friendUserId && item.friendUserId === userId)));
  }

  listBodyLogBlocks(appId: string): BodyLogBlockRecord[] {
    return structuredClone(this.bodyLogBlocks.filter((item) => item.appId === appId));
  }

  insertBodyLogBlock(record: BodyLogBlockRecord): void {
    const exists = this.bodyLogBlocks.some((item) =>
      item.appId === record.appId && item.blockerUserId === record.blockerUserId &&
      item.blockedUserId === record.blockedUserId);
    if (!exists) this.bodyLogBlocks.push(structuredClone(record));
  }

  deleteBodyLogBlock(appId: string, blockerUserId: string, blockedUserId: string): void {
    this.bodyLogBlocks = this.bodyLogBlocks.filter((item) =>
      item.appId !== appId || item.blockerUserId !== blockerUserId ||
      item.blockedUserId !== blockedUserId);
  }

  insertBodyLogReport(record: BodyLogReportRecord): void {
    this.bodyLogReports.push(structuredClone(record));
  }

  listBodyLogReports(appId: string, reporterUserId: string): BodyLogReportRecord[] {
    return structuredClone(this.bodyLogReports.filter((item) =>
      item.appId === appId && item.reporterUserId === reporterUserId));
  }

  findBodyLogWeeklyGoalSnapshot(appId: string, userId: string, seasonLabel: string) {
    return structuredClone(this.bodyLogWeeklyGoalSnapshots.find((item) =>
      item.appId === appId && item.userId === userId && item.seasonLabel === seasonLabel));
  }

  upsertBodyLogWeeklyGoalSnapshot(record: BodyLogWeeklyGoalSnapshot) {
    const index = this.bodyLogWeeklyGoalSnapshots.findIndex((item) =>
      item.appId === record.appId && item.userId === record.userId &&
      item.seasonLabel === record.seasonLabel);
    if (index >= 0) this.bodyLogWeeklyGoalSnapshots[index] = structuredClone(record);
    else this.bodyLogWeeklyGoalSnapshots.push(structuredClone(record));
    return structuredClone(record);
  }

  listBodyLogDailyAggregates(appId: string, userId: string, seasonLabel: string) {
    return structuredClone(this.bodyLogDailyAggregates.filter((item) =>
      item.appId === appId && item.userId === userId && item.seasonLabel === seasonLabel));
  }

  upsertBodyLogDailyAggregate(record: BodyLogDailyAggregate) {
    const index = this.bodyLogDailyAggregates.findIndex((item) =>
      item.appId === record.appId && item.userId === record.userId &&
      item.seasonLabel === record.seasonLabel && item.date === record.date);
    if (index >= 0) this.bodyLogDailyAggregates[index] = structuredClone(record);
    else this.bodyLogDailyAggregates.push(structuredClone(record));
    return structuredClone(record);
  }

  findBodyLogLeaderboardEntry(appId: string, userId: string, seasonLabel: string) {
    return structuredClone(this.bodyLogLeaderboardEntries.find((item) =>
      item.appId === appId && item.userId === userId && item.seasonLabel === seasonLabel));
  }

  upsertBodyLogLeaderboardEntry(record: BodyLogLeaderboardEntryRecord) {
    const index = this.bodyLogLeaderboardEntries.findIndex((item) =>
      item.appId === record.appId && item.userId === record.userId &&
      item.seasonLabel === record.seasonLabel);
    if (index >= 0) this.bodyLogLeaderboardEntries[index] = structuredClone(record);
    else this.bodyLogLeaderboardEntries.push(structuredClone(record));
    return structuredClone(record);
  }

  listBodyLogLeaderboardEntries(appId: string, seasonLabel: string) {
    return structuredClone(this.bodyLogLeaderboardEntries.filter((item) =>
      item.appId === appId && item.seasonLabel === seasonLabel));
  }

  findBodyLogInvitationByTokenHash(appId: string, tokenHash: string) {
    return structuredClone(this.bodyLogInvitations.find((item) =>
      item.appId === appId && item.tokenHash === tokenHash));
  }

  insertBodyLogInvitation(record: BodyLogInvitationRecord): void {
    this.bodyLogInvitations.push(structuredClone(record));
  }

  listBodyLogInvitations(appId: string, inviterUserId: string) {
    return structuredClone(this.bodyLogInvitations.filter((item) =>
      item.appId === appId && item.inviterUserId === inviterUserId));
  }

  insertBodyLogInvitationAttribution(record: BodyLogInvitationAttributionRecord): void {
    this.bodyLogInvitationAttributions.push(structuredClone(record));
  }

  updateBodyLogInvitationAttribution(record: BodyLogInvitationAttributionRecord): void {
    const index = this.bodyLogInvitationAttributions.findIndex((item) => item.id === record.id);
    if (index >= 0) this.bodyLogInvitationAttributions[index] = structuredClone(record);
  }

  listBodyLogInvitationAttributions(appId: string) {
    return structuredClone(this.bodyLogInvitationAttributions.filter((item) => item.appId === appId));
  }

  insertBodyLogChallenge(record: BodyLogChallengeRecord): void {
    this.bodyLogChallenges.push(structuredClone(record));
  }

  updateBodyLogChallenge(record: BodyLogChallengeRecord): void {
    const index = this.bodyLogChallenges.findIndex((item) => item.id === record.id);
    if (index >= 0) this.bodyLogChallenges[index] = structuredClone(record);
  }

  listBodyLogChallenges(appId: string) {
    return structuredClone(this.bodyLogChallenges.filter((item) => item.appId === appId));
  }

  insertBodyLogChallengeMembers(records: BodyLogChallengeMemberRecord[]): void {
    this.bodyLogChallengeMembers.push(...structuredClone(records));
  }

  updateBodyLogChallengeMember(record: BodyLogChallengeMemberRecord): void {
    const index = this.bodyLogChallengeMembers.findIndex((item) =>
      item.challengeId === record.challengeId && item.userId === record.userId);
    if (index >= 0) this.bodyLogChallengeMembers[index] = structuredClone(record);
  }

  listBodyLogChallengeMembers(appId: string) {
    return structuredClone(this.bodyLogChallengeMembers.filter((item) => item.appId === appId));
  }

  listRoles(appId?: string): RoleRecord[] {
    return appId ? this.roles.filter((item) => item.appId === appId) : this.roles;
  }

  findRole(appId: string, roleCode: string): RoleRecord | undefined {
    return this.roles.find((item) => item.appId === appId && item.code === roleCode);
  }

  insertRoles(records: RoleRecord[]): void {
    this.roles.push(...structuredClone(records));
  }

  listPermissions(): PermissionRecord[] {
    return this.permissions;
  }

  insertRolePermissions(records: RolePermissionRecord[]): void {
    this.rolePermissions.push(...structuredClone(records));
  }

  findUserRole(appId: string, userId: string, roleId: string): UserRoleRecord | undefined {
    return this.userRoles.find((item) => item.appId === appId && item.userId === userId && item.roleId === roleId);
  }

  insertUserRole(record: UserRoleRecord): void {
    this.userRoles.push(structuredClone(record));
  }

  getPermissionCodes(appId: string, userId: string): string[] {
    const roleIds = this.userRoles
      .filter((item) => item.appId === appId && item.userId === userId)
      .map((item) => item.roleId);
    const permissionIds = this.rolePermissions
      .filter((item) => roleIds.includes(item.roleId))
      .map((item) => item.permissionId);

    return this.permissions
      .filter((item) => permissionIds.includes(item.id))
      .map((item) => item.code);
  }

  findUserById(userId: string): UserRecord | undefined {
    return this.users.find((item) => item.id === userId);
  }

  findUserByAccount(account: string): UserRecord | undefined {
    const normalized = account.trim().toLowerCase();
    return this.users.find(
      (item) =>
        item.email?.toLowerCase() === normalized || item.phone?.toLowerCase() === normalized,
    );
  }

  findUserByPhone(phone: string): UserRecord | undefined {
    const normalized = phone.trim().toLowerCase();
    return this.users.find((item) => item.phone?.toLowerCase() === normalized);
  }

  insertUser(record: UserRecord): void {
    this.users.push(structuredClone(record));
  }

  updateUserEmail(userId: string, email: string): void {
    const user = this.findUserById(userId);
    if (!user) {
      return;
    }

    user.email = email;
  }

  updateUserPassword(userId: string, passwordHash: string, passwordAlgo: string): void {
    const user = this.findUserById(userId);
    if (!user) {
      return;
    }

    user.passwordHash = passwordHash;
    user.passwordAlgo = passwordAlgo;
  }

  insertAuditLog(record: AuditLogRecord): void {
    this.auditLogs.push(structuredClone(record));
  }

  listAppConfigs(appId?: string): AppConfigRecord[] {
    return appId ? this.appConfigs.filter((item) => item.appId === appId) : this.appConfigs;
  }

  findAppConfig(appId: string, configKey: string): AppConfigRecord | undefined {
    return this.appConfigs.find((item) => item.appId === appId && item.configKey === configKey);
  }

  upsertAppConfig(record: AppConfigRecord): AppConfigRecord {
    const existing = this.findAppConfig(record.appId, record.configKey);
    if (existing) {
      existing.configValue = record.configValue;
      existing.updatedAt = record.updatedAt;
      return existing;
    }

    const created = structuredClone(record);
    this.appConfigs.push(created);
    return created;
  }

  deleteAppConfigsByApp(appId: string): void {
    this.appConfigs = this.appConfigs.filter((item) => item.appId !== appId);
  }

  insertAnalyticsEvents(records: AnalyticsEventRecord[]): void {
    this.analyticsEvents.push(...structuredClone(records));
  }

  listAnalyticsEvents(appId: string): AnalyticsEventRecord[] {
    return this.analyticsEvents.filter((item) => item.appId === appId);
  }

  insertFile(record: FileRecord): void {
    this.files.push(structuredClone(record));
  }

  findFileByOwnerAndStorageKey(appId: string, ownerUserId: string, storageKey: string): FileRecord | undefined {
    return this.files.find(
      (item) => item.appId === appId && item.ownerUserId === ownerUserId && item.storageKey === storageKey,
    );
  }

  findFileByAppAndStorageKey(appId: string, storageKey: string): FileRecord | undefined {
    return this.files.find((item) => item.appId === appId && item.storageKey === storageKey);
  }

  confirmFile(fileId: string, mimeType: string, sizeBytes: number): FileRecord | undefined {
    const file = this.files.find((item) => item.id === fileId);
    if (!file) {
      return undefined;
    }

    file.status = "CONFIRMED";
    file.mimeType = mimeType;
    file.sizeBytes = sizeBytes;
    return file;
  }

  listSmsVerificationRecords(appId?: string): SmsVerificationRecord[] {
    const items = appId ? this.smsVerificationRecords.filter((item) => item.appId === appId) : this.smsVerificationRecords;
    return structuredClone(items).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  findSmsVerificationRecord(recordId: string): SmsVerificationRecord | undefined {
    const found = this.smsVerificationRecords.find((item) => item.id === recordId);
    return found ? structuredClone(found) : undefined;
  }

  insertSmsVerificationRecord(record: SmsVerificationRecord): void {
    this.smsVerificationRecords.push(structuredClone(record));
  }

  updateSmsVerificationRecord(
    recordId: string,
    patch: Partial<
      Pick<
        SmsVerificationRecord,
        "status" | "providerRequestId" | "providerSerialNo" | "providerMessage" | "consumedAt" | "failedAt" | "revealCount" | "lastRevealedAt" | "updatedAt"
      >
    >,
  ): void {
    const index = this.smsVerificationRecords.findIndex((item) => item.id === recordId);
    if (index === -1) {
      return;
    }
    this.smsVerificationRecords[index] = {
      ...this.smsVerificationRecords[index],
      ...structuredClone(patch),
    };
  }

  deleteSmsVerificationRecordsCreatedBefore(cutoffIso: string): number {
    const before = this.smsVerificationRecords.length;
    const cutoffMs = new Date(cutoffIso).getTime();
    this.smsVerificationRecords = this.smsVerificationRecords.filter((item) => new Date(item.createdAt).getTime() >= cutoffMs);
    return before - this.smsVerificationRecords.length;
  }

  insertEmailDeliveryEvent(record: EmailDeliveryEventRecord): void {
    this.emailDeliveryEvents.push(structuredClone(record));
  }

  listEmailDeliveryEvents(filter: {
    event?: EmailDeliveryEventRecord["event"];
    email?: string;
    limit?: number;
  } = {}): EmailDeliveryEventRecord[] {
    const normalizedEmail = filter.email?.trim().toLowerCase() ?? "";
    const limit = normalizeListLimit(filter.limit);
    return structuredClone(this.emailDeliveryEvents)
      .filter((item) => !filter.event || item.event === filter.event)
      .filter((item) => !normalizedEmail || item.email.toLowerCase().includes(normalizedEmail))
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, limit);
  }

  insertNotificationJob(record: NotificationJobRecord): void {
    this.notificationJobs.push(structuredClone(record));
  }

  findNotificationJob(jobId: string): NotificationJobRecord | undefined {
    return this.notificationJobs.find((item) => item.id === jobId);
  }

  updateNotificationJob(
    jobId: string,
    patch: Partial<Pick<NotificationJobRecord, "status" | "retryCount">>,
  ): NotificationJobRecord | undefined {
    const job = this.findNotificationJob(jobId);
    if (!job) {
      return undefined;
    }

    if (patch.status) {
      job.status = patch.status;
    }
    if (typeof patch.retryCount === "number") {
      job.retryCount = patch.retryCount;
    }
    return job;
  }

  upsertFrogSleepDevice(record: FrogSleepDeviceRecord): FrogSleepDeviceRecord {
    const existing = this.frogSleepDevices.find(
      (item) =>
        item.appId === record.appId &&
        item.userId === record.userId &&
        item.pushToken === record.pushToken,
    );
    if (existing) {
      existing.platform = record.platform;
      existing.appVersion = record.appVersion;
      existing.timezone = record.timezone;
      existing.pushEnabled = record.pushEnabled;
      existing.updatedAt = record.updatedAt;
      existing.deletedAt = undefined;
      return structuredClone(existing);
    }

    this.frogSleepDevices.push(structuredClone(record));
    return structuredClone(record);
  }

  deleteFrogSleepDevice(
    appId: string,
    userId: string,
    deviceId: string,
  ): FrogSleepDeviceRecord | undefined {
    const device = this.frogSleepDevices.find(
      (item) => item.appId === appId && item.userId === userId && item.id === deviceId,
    );
    if (!device) {
      return undefined;
    }

    device.pushEnabled = false;
    device.updatedAt = new Date().toISOString();
    device.deletedAt = device.updatedAt;
    return structuredClone(device);
  }

  listFrogSleepDevices(filter: {
    appId: string;
    userId?: string;
    pushEnabled?: boolean;
    includeDeleted?: boolean;
  }): FrogSleepDeviceRecord[] {
    return structuredClone(this.frogSleepDevices)
      .filter((item) => item.appId === filter.appId)
      .filter((item) => filter.userId ? item.userId === filter.userId : true)
      .filter((item) => typeof filter.pushEnabled === "boolean" ? item.pushEnabled === filter.pushEnabled : true)
      .filter((item) => filter.includeDeleted ? true : !item.deletedAt)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  insertFrogSleepEntity(record: FrogSleepEntityRecord): void {
    this.assertFrogSleepLiveRelationshipUnique(record);
    this.frogSleepEntities.push(structuredClone(record));
  }

  findFrogSleepEntity(
    kind: FrogSleepEntityKind,
    appId: string,
    id: string,
  ): FrogSleepEntityRecord | undefined {
    return structuredClone(
      this.frogSleepEntities.find(
        (item) => item.kind === kind && item.appId === appId && item.id === id,
      ),
    );
  }

  findFrogSleepEntityByCode(
    kind: FrogSleepEntityKind,
    appId: string,
    code: string,
  ): FrogSleepEntityRecord | undefined {
    return structuredClone(
      this.frogSleepEntities.find(
        (item) =>
          item.kind === kind &&
          item.appId === appId &&
          item.code === code &&
          !item.deletedAt,
      ),
    );
  }

  findFrogSleepEntityByToken(
    kind: FrogSleepEntityKind,
    appId: string,
    token: string,
  ): FrogSleepEntityRecord | undefined {
    return structuredClone(
      this.frogSleepEntities.find(
        (item) =>
          item.kind === kind &&
          item.appId === appId &&
          item.token === token &&
          !item.deletedAt,
      ),
    );
  }

  listFrogSleepEntities(filter: FrogSleepEntityFilter): FrogSleepEntityRecord[] {
    const records = structuredClone(this.frogSleepEntities)
      .filter((item) => item.appId === filter.appId)
      .filter((item) => filter.kind ? item.kind === filter.kind : true)
      .filter((item) => filter.ownerUserId ? item.ownerUserId === filter.ownerUserId : true)
      .filter((item) => filter.partnerUserId ? item.partnerUserId === filter.partnerUserId : true)
      .filter((item) => filter.relationshipId ? item.relationshipId === filter.relationshipId : true)
      .filter((item) => filter.sessionId ? item.sessionId === filter.sessionId : true)
      .filter((item) => filter.status ? item.status === filter.status : true)
      .filter((item) => filter.code ? item.code === filter.code : true)
      .filter((item) => filter.token ? item.token === filter.token : true)
      .filter((item) => filter.startsAtFromIso ? (item.startsAt ?? "") >= filter.startsAtFromIso : true)
      .filter((item) => filter.startsAtToIso ? (item.startsAt ?? "") < filter.startsAtToIso : true)
      .filter((item) => filter.occurredAtFromIso ? (item.occurredAt ?? "") >= filter.occurredAtFromIso : true)
      .filter((item) => filter.occurredAtToIso ? (item.occurredAt ?? "") < filter.occurredAtToIso : true)
      .filter((item) => filter.includeDeleted ? true : !item.deletedAt)
      .sort((left, right) => {
        const leftTime = left.occurredAt ?? left.startsAt ?? left.createdAt;
        const rightTime = right.occurredAt ?? right.startsAt ?? right.createdAt;
        return rightTime.localeCompare(leftTime);
      });
    return records.slice(0, normalizeListLimit(filter.limit));
  }

  updateFrogSleepEntity(
    kind: FrogSleepEntityKind,
    appId: string,
    id: string,
    patch: Partial<Omit<FrogSleepEntityRecord, "id" | "kind" | "appId" | "createdAt">>,
  ): FrogSleepEntityRecord | undefined {
    const record = this.frogSleepEntities.find(
      (item) => item.kind === kind && item.appId === appId && item.id === id,
    );
    if (!record) {
      return undefined;
    }

    Object.assign(record, {
      ...patch,
      payload: patch.payload ?? record.payload,
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
    });
    return structuredClone(record);
  }

  upsertFrogSleepBuddySharingGrant(record: FrogSleepBuddySharingGrantRecord): FrogSleepBuddySharingGrantRecord {
    const existing = this.frogSleepBuddySharingGrants.find((item) =>
      item.appId === record.appId && item.relationshipId === record.relationshipId &&
      item.grantorUserId === record.grantorUserId && item.granteeUserId === record.granteeUserId &&
      item.domain === record.domain && item.category === record.category
    );
    if (existing) Object.assign(existing, record, { id: existing.id });
    else this.frogSleepBuddySharingGrants.push(structuredClone(record));
    return structuredClone(existing ?? record);
  }

  listFrogSleepBuddySharingGrants(appId: string, relationshipId: string): FrogSleepBuddySharingGrantRecord[] {
    return structuredClone(this.frogSleepBuddySharingGrants)
      .filter((item) => item.appId === appId && item.relationshipId === relationshipId)
      .sort((left, right) => left.grantorUserId.localeCompare(right.grantorUserId) || left.category.localeCompare(right.category));
  }

  findFrogSleepBuddySharingGrant(appId: string, grantId: string): FrogSleepBuddySharingGrantRecord | undefined {
    return structuredClone(this.frogSleepBuddySharingGrants.find((item) => item.appId === appId && item.id === grantId));
  }

  updateFrogSleepBuddySharingGrant(
    appId: string,
    grantId: string,
    expectedVersion: number,
    state: FrogSleepBuddySharingGrantRecord["state"],
  ): FrogSleepBuddySharingGrantRecord | undefined {
    const grant = this.frogSleepBuddySharingGrants.find((item) => item.appId === appId && item.id === grantId);
    if (!grant || grant.version !== expectedVersion) return undefined;
    const now = new Date().toISOString();
    Object.assign(grant, { state, version: grant.version + 1, updatedAt: now,
      grantedAt: state === "granted" ? now : grant.grantedAt,
      revokedAt: state === "revoked" ? now : undefined });
    return structuredClone(grant);
  }

  upsertFrogSleepBuddyInvitationBundle(record: FrogSleepBuddyInvitationBundleRecord): FrogSleepBuddyInvitationBundleRecord {
    const index = this.frogSleepBuddyInvitationBundles.findIndex((item) =>
      item.appId === record.appId && item.id === record.id
    );
    if (index >= 0) this.frogSleepBuddyInvitationBundles[index] = structuredClone(record);
    else this.frogSleepBuddyInvitationBundles.push(structuredClone(record));
    return structuredClone(record);
  }

  findFrogSleepBuddyInvitationBundle(appId: string, bundleId: string): FrogSleepBuddyInvitationBundleRecord | undefined {
    return structuredClone(this.frogSleepBuddyInvitationBundles.find((item) =>
      item.appId === appId && item.id === bundleId
    ));
  }

  listFrogSleepBuddyInvitationBundles(input: {
    appId: string; userId: string; direction: "incoming" | "outgoing";
    recipientEmailHash?: string; recipientEmail?: string;
  }): FrogSleepBuddyInvitationBundleRecord[] {
    return structuredClone(this.frogSleepBuddyInvitationBundles).filter((item) => item.appId === input.appId &&
      (input.direction === "incoming"
        ? item.inviteeUserId === input.userId
          || (!item.inviteeUserId && Boolean(input.recipientEmailHash)
            && (item.recipientEmailHash === input.recipientEmailHash
              || item.recipientEmail?.toLowerCase() === input.recipientEmail?.toLowerCase()))
        : item.inviterUserId === input.userId))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  findFrogSleepBuddyInvitationBundleByCode(
    appId: string,
    code: string,
  ): FrogSleepBuddyInvitationBundleRecord | undefined {
    const normalized = code.trim().toUpperCase();
    return structuredClone(this.frogSleepBuddyInvitationBundles.find((item) =>
      item.appId === appId && item.shareCode.toUpperCase() === normalized
    ));
  }

  findFrogSleepBuddyInvitationBundleByToken(
    appId: string,
    token: string,
  ): FrogSleepBuddyInvitationBundleRecord | undefined {
    return structuredClone(this.frogSleepBuddyInvitationBundles.find((item) =>
      item.appId === appId && item.handoffToken === token.trim()
    ));
  }

  enqueueFrogSleepBuddyInvitationEmailDelivery(
    record: FrogSleepBuddyInvitationEmailDeliveryRecord,
  ): FrogSleepBuddyInvitationEmailDeliveryRecord {
    const existing = this.frogSleepBuddyInvitationEmailDeliveries.find((item) =>
      item.appId === record.appId && item.invitationId === record.invitationId
    );
    if (existing) return structuredClone(existing);
    this.frogSleepBuddyInvitationEmailDeliveries.push(structuredClone(record));
    return structuredClone(record);
  }

  findFrogSleepBuddyInvitationEmailDelivery(
    appId: string,
    invitationId: string,
  ): FrogSleepBuddyInvitationEmailDeliveryRecord | undefined {
    return structuredClone(this.frogSleepBuddyInvitationEmailDeliveries.find((item) =>
      item.appId === appId && item.invitationId === invitationId
    ));
  }

  findFrogSleepBuddyInvitationEmailDeliveryByProviderMessageId(
    providerMessageId: string,
  ): FrogSleepBuddyInvitationEmailDeliveryRecord | undefined {
    return structuredClone(this.frogSleepBuddyInvitationEmailDeliveries.find((item) =>
      item.providerMessageId === providerMessageId
    ));
  }

  listFrogSleepBuddyInvitationEmailDeliveries(filter: {
    invitationId?: string;
    status?: FrogSleepBuddyInvitationEmailDeliveryRecord["status"];
    limit?: number;
  } = {}): FrogSleepBuddyInvitationEmailDeliveryRecord[] {
    return structuredClone(this.frogSleepBuddyInvitationEmailDeliveries)
      .filter((item) => (!filter.invitationId || item.invitationId === filter.invitationId)
        && (!filter.status || item.status === filter.status))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.max(1, Math.min(filter.limit ?? 100, 500)));
  }

  claimReadyFrogSleepBuddyInvitationEmailDeliveries(
    nowIso: string,
    limit: number,
  ): FrogSleepBuddyInvitationEmailDeliveryRecord[] {
    const staleProcessingCutoff = new Date(new Date(nowIso).getTime() - 15 * 60 * 1000).toISOString();
    const claimed = this.frogSleepBuddyInvitationEmailDeliveries
      .filter((item) =>
        (["queued", "retryable_failed"].includes(item.status) && item.availableAt <= nowIso)
        || (item.status === "processing" && item.updatedAt <= staleProcessingCutoff)
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, limit);
    for (const delivery of claimed) {
      delivery.status = "processing";
      delivery.attemptCount += 1;
      delivery.lastErrorCode = undefined;
      delivery.updatedAt = nowIso;
    }
    return structuredClone(claimed);
  }

  updateFrogSleepBuddyInvitationEmailDelivery(
    id: string,
    patch: Partial<Omit<FrogSleepBuddyInvitationEmailDeliveryRecord, "id" | "appId" | "invitationId" | "createdAt">>,
  ): FrogSleepBuddyInvitationEmailDeliveryRecord | undefined {
    const delivery = this.frogSleepBuddyInvitationEmailDeliveries.find((item) => item.id === id);
    if (!delivery) return undefined;
    Object.assign(delivery, structuredClone(patch));
    return structuredClone(delivery);
  }

  insertFrogSleepBuddyInvitationEmailAttempt(
    record: FrogSleepBuddyInvitationEmailAttemptRecord,
  ): FrogSleepBuddyInvitationEmailAttemptRecord {
    const existing = this.frogSleepBuddyInvitationEmailAttempts.find((item) =>
      item.deliveryId === record.deliveryId && item.attempt === record.attempt
    );
    if (existing) {
      Object.assign(existing, structuredClone(record), { id: existing.id });
      return structuredClone(existing);
    }
    this.frogSleepBuddyInvitationEmailAttempts.push(structuredClone(record));
    return structuredClone(record);
  }

  listFrogSleepBuddyInvitationEmailAttempts(
    appId: string,
    deliveryId: string,
  ): FrogSleepBuddyInvitationEmailAttemptRecord[] {
    return structuredClone(this.frogSleepBuddyInvitationEmailAttempts)
      .filter((item) => item.appId === appId && item.deliveryId === deliveryId)
      .sort((left, right) => left.attempt - right.attempt);
  }

  upsertFrogSleepBuddyInvitationDomainDecision(
    record: FrogSleepBuddyInvitationDomainDecisionRecord,
  ): FrogSleepBuddyInvitationDomainDecisionRecord {
    const existing = this.frogSleepBuddyInvitationDomainDecisions.find((item) =>
      item.appId === record.appId && item.invitationId === record.invitationId && item.domain === record.domain
    );
    const stored = {
      ...record,
      createdAt: existing?.createdAt ?? record.createdAt,
    };
    if (existing) Object.assign(existing, stored);
    else this.frogSleepBuddyInvitationDomainDecisions.push(structuredClone(stored));
    return structuredClone(existing ?? stored);
  }

  findFrogSleepBuddyInvitationDomainDecision(
    appId: string,
    invitationId: string,
    domain: FrogSleepBuddyInvitationDomainDecisionRecord["domain"],
  ): FrogSleepBuddyInvitationDomainDecisionRecord | undefined {
    return structuredClone(this.frogSleepBuddyInvitationDomainDecisions.find((item) =>
      item.appId === appId && item.invitationId === invitationId && item.domain === domain
    ));
  }

  listFrogSleepBuddyInvitationDomainDecisions(
    appId: string,
    invitationId: string,
  ): FrogSleepBuddyInvitationDomainDecisionRecord[] {
    return structuredClone(this.frogSleepBuddyInvitationDomainDecisions)
      .filter((item) => item.appId === appId && item.invitationId === invitationId)
      .sort((left, right) => left.domain.localeCompare(right.domain));
  }

  compareAndUpdateFrogSleepBuddyInvitationDomainDecision(input: {
    appId: string; invitationId: string; domain: FrogSleepBuddyInvitationDomainDecisionRecord["domain"];
    expectedVersion: number; status: FrogSleepBuddyInvitationDomainDecisionRecord["status"];
    decidedByUserId: string; decidedAt: string; idempotencyKeyHash: string; terminalReason?: string; updatedAt: string;
  }): FrogSleepBuddyInvitationDomainDecisionRecord | undefined {
    const decision = this.frogSleepBuddyInvitationDomainDecisions.find((item) =>
      item.appId === input.appId && item.invitationId === input.invitationId && item.domain === input.domain
    );
    if (!decision || decision.status !== "pending" || decision.version !== input.expectedVersion) return undefined;
    Object.assign(decision, { status: input.status, version: decision.version + 1,
      decidedByUserId: input.decidedByUserId, decidedAt: input.decidedAt,
      idempotencyKeyHash: input.idempotencyKeyHash, terminalReason: input.terminalReason, updatedAt: input.updatedAt });
    return structuredClone(decision);
  }

  ensureFrogSleepBuddyDomainSlot(input: {
    appId: string; userId: string; domain: FrogSleepBuddyDomainSlotRecord["domain"]; now: string;
  }): FrogSleepBuddyDomainSlotRecord {
    assertValidFrogSleepBuddyDomainSlot({ domain: input.domain, state: "available" });
    const existing = this.findFrogSleepBuddyDomainSlot(input.appId, input.userId, input.domain);
    if (existing) return existing;
    const slot: FrogSleepBuddyDomainSlotRecord = {
      appId: input.appId, userId: input.userId, domain: input.domain, state: "available", version: 1,
      createdAt: input.now, updatedAt: input.now,
    };
    this.frogSleepBuddyDomainSlots.push(slot);
    return structuredClone(slot);
  }

  findFrogSleepBuddyDomainSlot(
    appId: string, userId: string, domain: FrogSleepBuddyDomainSlotRecord["domain"],
  ): FrogSleepBuddyDomainSlotRecord | undefined {
    return structuredClone(this.frogSleepBuddyDomainSlots.find((slot) =>
      slot.appId === appId && slot.userId === userId && slot.domain === domain,
    ));
  }

  listFrogSleepBuddyDomainSlots(appId: string, userId: string): FrogSleepBuddyDomainSlotRecord[] {
    return structuredClone(this.frogSleepBuddyDomainSlots.filter((slot) =>
      slot.appId === appId && slot.userId === userId,
    ).sort((left, right) => left.domain.localeCompare(right.domain)));
  }

  compareAndUpdateFrogSleepBuddyDomainSlot(input: {
    appId: string; userId: string; domain: FrogSleepBuddyDomainSlotRecord["domain"]; expectedVersion: number;
    state: FrogSleepBuddyDomainSlotRecord["state"]; relationshipId?: string; updatedAt: string;
  }): FrogSleepBuddyDomainSlotRecord | undefined {
    assertValidFrogSleepBuddyDomainSlot(input);
    const slot = this.frogSleepBuddyDomainSlots.find((item) =>
      item.appId === input.appId && item.userId === input.userId && item.domain === input.domain,
    );
    if (!slot || slot.version !== input.expectedVersion) return undefined;
    Object.assign(slot, {
      state: input.state, relationshipId: input.relationshipId, version: slot.version + 1, updatedAt: input.updatedAt,
    });
    return structuredClone(slot);
  }

  insertFrogSleepBuddyDomainRelationship(
    record: FrogSleepBuddyDomainRelationshipRecord,
  ): FrogSleepBuddyDomainRelationshipRecord {
    const normalized = normalizeFrogSleepBuddyDomainRelationship(record);
    const existing = this.frogSleepBuddyDomainRelationships.find((item) => item.id === normalized.id);
    if (existing) {
      if (existing.appId !== normalized.appId) throw new Error("FrogSleep buddy domain relationship ID collision.");
      return structuredClone(existing);
    }
    if (normalized.status !== "revoked" && this.frogSleepBuddyDomainRelationships.some((item) =>
      item.appId === normalized.appId && item.domain === normalized.domain && item.status !== "revoked" &&
      item.userIdLow === normalized.userIdLow && item.userIdHigh === normalized.userIdHigh
    )) throw new Error("FrogSleep buddy domain relationship current pair already exists.");
    this.frogSleepBuddyDomainRelationships.push(normalized);
    return structuredClone(normalized);
  }

  findFrogSleepBuddyDomainRelationship(
    appId: string, relationshipId: string,
  ): FrogSleepBuddyDomainRelationshipRecord | undefined {
    return structuredClone(this.frogSleepBuddyDomainRelationships.find((item) =>
      item.appId === appId && item.id === relationshipId,
    ));
  }

  listCurrentFrogSleepBuddyDomainRelationships(
    appId: string, userId: string, domain: FrogSleepBuddyDomainRelationshipRecord["domain"],
  ): FrogSleepBuddyDomainRelationshipRecord[] {
    return structuredClone(this.frogSleepBuddyDomainRelationships.filter((item) =>
      item.appId === appId && item.domain === domain && item.status !== "revoked" &&
      (item.userIdLow === userId || item.userIdHigh === userId),
    ).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id)));
  }

  compareAndUpdateFrogSleepBuddyDomainRelationship(input: {
    appId: string; id: string; expectedVersion: number; status: FrogSleepBuddyDomainRelationshipRecord["status"];
    pausedByUserIds: string[]; revokedAt?: string; updatedAt: string;
  }): FrogSleepBuddyDomainRelationshipRecord | undefined {
    const normalizedInput = normalizeFrogSleepBuddyDomainRelationshipUpdate(input);
    const existing = this.frogSleepBuddyDomainRelationships.find((item) =>
      item.appId === normalizedInput.appId && item.id === normalizedInput.id,
    );
    if (!existing || existing.version !== normalizedInput.expectedVersion) return undefined;
    const updated = normalizeFrogSleepBuddyDomainRelationship({
      ...existing, status: normalizedInput.status, pausedByUserIds: normalizedInput.pausedByUserIds,
      revokedAt: normalizedInput.revokedAt, version: existing.version + 1, updatedAt: normalizedInput.updatedAt,
    });
    if (updated.status !== "revoked" && this.frogSleepBuddyDomainRelationships.some((item) =>
      item.id !== updated.id && item.appId === updated.appId && item.domain === updated.domain &&
      item.status !== "revoked" && item.userIdLow === updated.userIdLow && item.userIdHigh === updated.userIdHigh
    )) throw new Error("FrogSleep buddy domain relationship current pair already exists.");
    Object.assign(existing, updated);
    return structuredClone(existing);
  }

  insertFrogSleepBuddyGroup(record: FrogSleepBuddyGroupRecord): FrogSleepBuddyGroupRecord {
    const existing = this.frogSleepBuddyGroups.find((item) => item.id === record.id);
    if (existing) {
      if (existing.appId !== record.appId) throw new Error("FrogSleep buddy group ID collision.");
      return structuredClone(existing);
    }
    this.frogSleepBuddyGroups.push(structuredClone(record));
    return structuredClone(record);
  }

  findFrogSleepBuddyGroup(appId: string, groupId: string): FrogSleepBuddyGroupRecord | undefined {
    return structuredClone(this.frogSleepBuddyGroups.find((item) =>
      item.appId === appId && item.id === groupId));
  }

  listFrogSleepBuddyGroupsForUser(appId: string, userId: string): FrogSleepBuddyGroupRecord[] {
    const groupIds = new Set(this.frogSleepBuddyGroupMembers
      .filter((member) => member.appId === appId && member.userId === userId && member.status === "active")
      .map((member) => member.groupId));
    return structuredClone(this.frogSleepBuddyGroups.filter((group) =>
      group.appId === appId && groupIds.has(group.id) && group.status !== "dissolved"
    ).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id)));
  }

  listFrogSleepBuddyGroupsForOwner(appId: string, ownerUserId: string): FrogSleepBuddyGroupRecord[] {
    return structuredClone(this.frogSleepBuddyGroups.filter((group) =>
      group.appId === appId && group.ownerUserId === ownerUserId && group.status !== "dissolved"
    ).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id)));
  }

  compareAndUpdateFrogSleepBuddyGroup(input: {
    appId: string; id: string; expectedVersion: number; status: FrogSleepBuddyGroupRecord["status"];
    memberCount: number; sharingBaseline: string[]; dissolvedAt?: string; updatedAt: string;
    groupName?: string; groupDescription?: string; groupDescriptionSpecified?: boolean;
  }): FrogSleepBuddyGroupRecord | undefined {
    const existing = this.frogSleepBuddyGroups.find((item) => item.appId === input.appId && item.id === input.id);
    if (!existing || existing.version !== input.expectedVersion) return undefined;
    const updated: FrogSleepBuddyGroupRecord = { ...existing, status: input.status, memberCount: input.memberCount,
      sharingBaseline: input.sharingBaseline, dissolvedAt: input.dissolvedAt,
      groupName: input.groupName ?? existing.groupName,
      groupDescription: input.groupDescriptionSpecified ? input.groupDescription : existing.groupDescription,
      version: existing.version + 1, updatedAt: input.updatedAt };
    Object.assign(existing, updated);
    return structuredClone(existing);
  }

  insertFrogSleepBuddyGroupMember(record: FrogSleepBuddyGroupMemberRecord): FrogSleepBuddyGroupMemberRecord {
    const existing = this.frogSleepBuddyGroupMembers.find((item) =>
      item.appId === record.appId && item.groupId === record.groupId && item.userId === record.userId);
    if (!existing) {
      this.frogSleepBuddyGroupMembers.push(structuredClone(record));
      return structuredClone(record);
    }
    Object.assign(existing, record);
    return structuredClone(existing);
  }

  findFrogSleepBuddyGroupMember(
    appId: string, groupId: string, userId: string,
  ): FrogSleepBuddyGroupMemberRecord | undefined {
    return structuredClone(this.frogSleepBuddyGroupMembers.find((item) =>
      item.appId === appId && item.groupId === groupId && item.userId === userId));
  }

  listFrogSleepBuddyGroupMembers(appId: string, groupId: string): FrogSleepBuddyGroupMemberRecord[] {
    return structuredClone(this.frogSleepBuddyGroupMembers.filter((item) =>
      item.appId === appId && item.groupId === groupId
    ).sort((left, right) => String(left.joinedAt ?? "").localeCompare(String(right.joinedAt ?? ""))
      || left.id.localeCompare(right.id)));
  }

  compareAndUpdateFrogSleepBuddyGroupMember(input: {
    appId: string; groupId: string; userId: string; expectedVersion: number;
    role: FrogSleepBuddyGroupMemberRecord["role"]; status: FrogSleepBuddyGroupMemberRecord["status"];
    leftAt?: string; updatedAt: string;
  }): FrogSleepBuddyGroupMemberRecord | undefined {
    const existing = this.frogSleepBuddyGroupMembers.find((item) =>
      item.appId === input.appId && item.groupId === input.groupId && item.userId === input.userId);
    if (!existing || existing.version !== input.expectedVersion) return undefined;
    const updated: FrogSleepBuddyGroupMemberRecord = { ...existing, role: input.role, status: input.status,
      leftAt: input.leftAt, version: existing.version + 1, updatedAt: input.updatedAt };
    Object.assign(existing, updated);
    return structuredClone(existing);
  }

  insertFrogSleepBuddyGroupInvitation(record: FrogSleepBuddyGroupInvitationRecord): FrogSleepBuddyGroupInvitationRecord {
    const existing = this.frogSleepBuddyGroupInvitations.find((item) => item.id === record.id);
    if (existing) {
      if (existing.appId !== record.appId) throw new Error("FrogSleep buddy group invitation ID collision.");
      return structuredClone(existing);
    }
    this.frogSleepBuddyGroupInvitations.push(structuredClone(record));
    return structuredClone(record);
  }

  findFrogSleepBuddyGroupInvitation(
    appId: string, invitationId: string,
  ): FrogSleepBuddyGroupInvitationRecord | undefined {
    return structuredClone(this.frogSleepBuddyGroupInvitations.find((item) =>
      item.appId === appId && item.id === invitationId));
  }

  listFrogSleepBuddyGroupInvitations(appId: string, groupId: string): FrogSleepBuddyGroupInvitationRecord[] {
    return structuredClone(this.frogSleepBuddyGroupInvitations.filter((item) =>
      item.appId === appId && item.groupId === groupId
    ).sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)));
  }

  compareAndUpdateFrogSleepBuddyGroupInvitation(input: {
    appId: string; invitationId: string; expectedVersion: number;
    status: FrogSleepBuddyGroupInvitationRecord["status"]; respondedAt?: string; updatedAt: string;
  }): FrogSleepBuddyGroupInvitationRecord | undefined {
    const existing = this.frogSleepBuddyGroupInvitations.find((item) =>
      item.appId === input.appId && item.id === input.invitationId);
    if (!existing || existing.version !== input.expectedVersion) return undefined;
    const updated: FrogSleepBuddyGroupInvitationRecord = { ...existing, status: input.status,
      respondedAt: input.respondedAt, version: existing.version + 1, updatedAt: input.updatedAt };
    Object.assign(existing, updated);
    return structuredClone(existing);
  }

  upsertFrogSleepBuddyInvitationReceiptAttempt(
    record: FrogSleepBuddyInvitationReceiptAttemptRecord,
  ): FrogSleepBuddyInvitationReceiptAttemptRecord {
    const existing = this.frogSleepBuddyInvitationReceiptAttempts.find((item) =>
      item.appId === record.appId && item.inviterUserId === record.inviterUserId &&
      item.recipientIdentityHash === record.recipientIdentityHash && item.domainsFingerprint === record.domainsFingerprint
    );
    if (!existing) {
      this.frogSleepBuddyInvitationReceiptAttempts.push(structuredClone(record));
      return structuredClone(record);
    }
    existing.updatedAt = record.updatedAt;
    return structuredClone(existing);
  }

  findFrogSleepBuddyInvitationReceiptAttempt(
    appId: string, inviterUserId: string, recipientIdentityHash: string, domainsFingerprint: string,
  ): FrogSleepBuddyInvitationReceiptAttemptRecord | undefined {
    return structuredClone(this.frogSleepBuddyInvitationReceiptAttempts.find((item) =>
      item.appId === appId && item.inviterUserId === inviterUserId &&
      item.recipientIdentityHash === recipientIdentityHash && item.domainsFingerprint === domainsFingerprint
    ));
  }

  findFrogSleepBuddyInvitationReceiptAttemptById(
    appId: string, inviterUserId: string, receiptId: string,
  ): FrogSleepBuddyInvitationReceiptAttemptRecord | undefined {
    return structuredClone(this.frogSleepBuddyInvitationReceiptAttempts.find((item) =>
      item.appId === appId && item.inviterUserId === inviterUserId && item.id === receiptId
    ));
  }

  enqueueFrogSleepBuddyNotificationOutbox(record: FrogSleepBuddyNotificationOutboxRecord): FrogSleepBuddyNotificationOutboxRecord {
    const existing = this.frogSleepBuddyNotificationOutbox.find((item) =>
      item.appId === record.appId && item.deduplicationKey === record.deduplicationKey
    );
    if (existing) return structuredClone(existing);
    this.frogSleepBuddyNotificationOutbox.push(structuredClone(record));
    return structuredClone(record);
  }

  listReadyFrogSleepBuddyNotificationOutbox(nowIso: string, limit: number): FrogSleepBuddyNotificationOutboxRecord[] {
    return structuredClone(this.frogSleepBuddyNotificationOutbox)
      .filter((item) => ["pending", "failed"].includes(item.status) && item.availableAt <= nowIso)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)).slice(0, limit);
  }

  updateFrogSleepBuddyNotificationOutbox(id: string, patch: Partial<FrogSleepBuddyNotificationOutboxRecord>) {
    const item = this.frogSleepBuddyNotificationOutbox.find((value) => value.id === id);
    if (!item) return undefined;
    Object.assign(item, patch);
    return structuredClone(item);
  }

  upsertFrogSleepBuddyNotification(record: FrogSleepBuddyNotificationRecord) {
    const existing = this.frogSleepBuddyNotifications.find((item) => item.appId === record.appId &&
      item.recipientUserId === record.recipientUserId && item.outboxId === record.outboxId);
    if (existing) return structuredClone(existing);
    this.frogSleepBuddyNotifications.push(structuredClone(record));
    return structuredClone(record);
  }

  findFrogSleepBuddyNotification(appId: string, recipientUserId: string, notificationId: string) {
    return structuredClone(this.frogSleepBuddyNotifications.find((item) => item.appId === appId &&
      item.recipientUserId === recipientUserId && item.id === notificationId));
  }

  listFrogSleepBuddyNotifications(input: { appId: string; recipientUserId: string; limit: number; cursor?: string }) {
    const items = structuredClone(this.frogSleepBuddyNotifications).filter((item) => item.appId === input.appId &&
      item.recipientUserId === input.recipientUserId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      .filter((item) => !input.cursor || `${item.createdAt}|${item.id}` < input.cursor).slice(0, input.limit);
    const last = items.at(-1);
    return { items, nextCursor: items.length === input.limit && last ? `${last.createdAt}|${last.id}` : undefined };
  }

  countUnreadFrogSleepBuddyNotifications(appId: string, recipientUserId: string) {
    return this.frogSleepBuddyNotifications.filter((item) => item.appId === appId && item.recipientUserId === recipientUserId && !item.readAt).length;
  }

  markFrogSleepBuddyNotificationRead(appId: string, recipientUserId: string, notificationId: string, readAt: string) {
    const item = this.frogSleepBuddyNotifications.find((value) => value.appId === appId &&
      value.recipientUserId === recipientUserId && value.id === notificationId);
    if (!item) return undefined;
    item.readAt ??= readAt; item.updatedAt = readAt;
    return structuredClone(item);
  }

  markAllFrogSleepBuddyNotificationsRead(appId: string, recipientUserId: string, readAt: string) {
    let count = 0;
    for (const item of this.frogSleepBuddyNotifications) if (item.appId === appId && item.recipientUserId === recipientUserId && !item.readAt) {
      item.readAt = readAt; item.updatedAt = readAt; count += 1;
    }
    return count;
  }

  insertFrogSleepBuddyNotificationDelivery(record: FrogSleepBuddyNotificationDeliveryRecord) {
    const existing = this.frogSleepBuddyNotificationDeliveries.find((item) => item.notificationId === record.notificationId &&
      item.channel === record.channel && item.attempt === record.attempt);
    if (existing) return structuredClone(existing);
    this.frogSleepBuddyNotificationDeliveries.push(structuredClone(record));
    return structuredClone(record);
  }

  private assertFrogSleepLiveRelationshipUnique(record: FrogSleepEntityRecord): void {
    if (!record.ownerUserId || !record.partnerUserId) {
      return;
    }
    const liveStatusesByKind: Partial<Record<FrogSleepEntityKind, Set<string>>> = {
      sleep_relationship: new Set(["active", "paused"]),
      focus_relationship: new Set(["pending", "accepted"]),
    };
    const liveStatuses = liveStatusesByKind[record.kind];
    if (!liveStatuses || !record.status || !liveStatuses.has(record.status)) {
      return;
    }
    const pair = [record.ownerUserId, record.partnerUserId].sort().join(":");
    const duplicate = this.frogSleepEntities.some((item) => {
      if (
        item.id === record.id ||
        item.appId !== record.appId ||
        item.kind !== record.kind ||
        !item.ownerUserId ||
        !item.partnerUserId ||
        !item.status ||
        !liveStatuses.has(item.status) ||
        item.deletedAt
      ) {
        return false;
      }
      return [item.ownerUserId, item.partnerUserId].sort().join(":") === pair;
    });
    if (duplicate) {
      conflict("REQ_INVALID_BODY", "A FrogSleep relationship already exists for this user pair.");
    }
  }

  insertFailedEvent(record: FailedEventRecord): void {
    this.failedEvents.push(structuredClone(record));
  }

  listFailedEvents(appId?: string): FailedEventRecord[] {
    return appId ? this.failedEvents.filter((item) => item.appId === appId) : this.failedEvents;
  }

  deleteFailedEvent(eventId: string): void {
    this.failedEvents = this.failedEvents.filter((item) => item.id !== eventId);
  }

  updateFailedEvent(
    eventId: string,
    patch: Pick<FailedEventRecord, "retryCount" | "errorMessage" | "nextRetryAt">,
  ): void {
    const event = this.failedEvents.find((item) => item.id === eventId);
    if (!event) {
      return;
    }

    event.retryCount = patch.retryCount;
    event.errorMessage = patch.errorMessage;
    event.nextRetryAt = patch.nextRetryAt;
  }

  listClientLogUploadTasks(appId?: string): ClientLogUploadTaskRecord[] {
    return appId ? this.clientLogUploadTasks.filter((item) => item.appId === appId) : this.clientLogUploadTasks;
  }

  findClientLogUploadTask(taskId: string): ClientLogUploadTaskRecord | undefined {
    return this.clientLogUploadTasks.find((item) => item.id === taskId);
  }

  insertClientLogUploadTask(record: ClientLogUploadTaskRecord): void {
    this.clientLogUploadTasks.push(structuredClone(record));
  }

  updateClientLogUploadTask(
    taskId: string,
    patch: Partial<
      Pick<
        ClientLogUploadTaskRecord,
        "status" | "did" | "claimToken" | "claimExpireAt" | "uploadedAt" | "uploadedFileName" | "uploadedFilePath" | "uploadedFileSizeBytes" | "uploadedLineCount" | "failedAt" | "failureReason"
      >
    >,
  ): void {
    const task = this.findClientLogUploadTask(taskId);
    if (!task) {
      return;
    }

    if ("status" in patch) {
      task.status = patch.status;
    }
    if ("did" in patch) {
      task.did = patch.did;
    }
    if ("claimToken" in patch) {
      task.claimToken = patch.claimToken;
    }
    if ("claimExpireAt" in patch) {
      task.claimExpireAt = patch.claimExpireAt;
    }
    if ("uploadedAt" in patch) {
      task.uploadedAt = patch.uploadedAt;
    }
    if ("uploadedFileName" in patch) {
      task.uploadedFileName = patch.uploadedFileName;
    }
    if ("uploadedFilePath" in patch) {
      task.uploadedFilePath = patch.uploadedFilePath;
    }
    if ("uploadedFileSizeBytes" in patch) {
      task.uploadedFileSizeBytes = patch.uploadedFileSizeBytes;
    }
    if ("uploadedLineCount" in patch) {
      task.uploadedLineCount = patch.uploadedLineCount;
    }
    if ("failedAt" in patch) {
      task.failedAt = patch.failedAt;
    }
    if ("failureReason" in patch) {
      task.failureReason = patch.failureReason;
    }
  }

  insertClientLogUpload(record: ClientLogUploadRecord): void {
    this.clientLogUploads.push(structuredClone(record));
  }

  insertClientLogLines(records: ClientLogLineRecord[]): void {
    this.clientLogLines.push(...structuredClone(records));
  }

  insertContentSafetyCheckRecord(record: ContentSafetyCheckRecord): void {
    this.contentSafetyCheckRecords.push(structuredClone(record));
  }

  listContentSafetyCheckRecords(filter: {
    createdAtFromIso?: string;
    createdAtToIso?: string;
    appId?: string;
    source?: ContentSafetyCheckRecord["source"];
    method?: ContentSafetyCheckRecord["method"];
    taskType?: string;
    decision?: ContentSafetyCheckRecord["decision"];
    limit?: number;
  } = {}): ContentSafetyCheckRecord[] {
    const records = structuredClone(this.contentSafetyCheckRecords)
      .filter((item) => filter.createdAtFromIso ? item.createdAt >= filter.createdAtFromIso : true)
      .filter((item) => filter.createdAtToIso ? item.createdAt < filter.createdAtToIso : true)
      .filter((item) => filter.appId ? item.appId === filter.appId : true)
      .filter((item) => filter.source ? item.source === filter.source : true)
      .filter((item) => filter.method ? item.method === filter.method : true)
      .filter((item) => filter.taskType ? item.taskType === filter.taskType : true)
      .filter((item) => filter.decision ? item.decision === filter.decision : true)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return typeof filter.limit === "number" && filter.limit > 0 ? records.slice(0, filter.limit) : records;
  }

  deleteContentSafetyCheckRecordsCreatedBefore(cutoffIso: string): number {
    const before = this.contentSafetyCheckRecords.length;
    this.contentSafetyCheckRecords = this.contentSafetyCheckRecords.filter((item) => item.createdAt >= cutoffIso);
    return before - this.contentSafetyCheckRecords.length;
  }

  insertFeedback(record: FeedbackRecord, attachments: FeedbackAttachmentRecord[]): void {
    this.feedbackRecords.push(structuredClone(record));
    this.feedbackAttachments.push(...structuredClone(attachments));
  }

  listFeedbackRecords(filter: {
    appId: string;
    userId?: string;
    ipHash?: string;
    status?: FeedbackRecord["status"];
    createdAtFromIso?: string;
    limit?: number;
  }): FeedbackRecord[] {
    const records = structuredClone(this.feedbackRecords)
      .filter((item) => item.appId === filter.appId)
      .filter((item) => filter.userId ? item.userId === filter.userId : true)
      .filter((item) => filter.ipHash ? item.ipHash === filter.ipHash : true)
      .filter((item) => filter.status ? item.status === filter.status : true)
      .filter((item) => filter.createdAtFromIso ? item.createdAt >= filter.createdAtFromIso : true)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return typeof filter.limit === "number" && filter.limit > 0
      ? records.slice(0, Math.min(Math.floor(filter.limit), 500))
      : records;
  }

  updateFeedbackStatus(
    appId: string,
    feedbackId: string,
    status: FeedbackRecord["status"],
  ): FeedbackRecord | undefined {
    const record = this.feedbackRecords.find((item) => item.appId === appId && item.id === feedbackId);
    if (!record) {
      return undefined;
    }
    record.status = status;
    record.updatedAt = new Date().toISOString();
    return structuredClone(record);
  }

  listFeedbackAttachments(feedbackIds: string[]): FeedbackAttachmentRecord[] {
    const ids = new Set(feedbackIds);
    return structuredClone(this.feedbackAttachments)
      .filter((item) => ids.has(item.feedbackId))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  findFeedbackAttachment(
    appId: string,
    feedbackId: string,
    attachmentId: string,
  ): FeedbackAttachmentRecord | undefined {
    return structuredClone(
      this.feedbackAttachments.find(
        (item) =>
          item.appId === appId &&
          item.feedbackId === feedbackId &&
          item.id === attachmentId,
      ),
    );
  }

  insertAiOutputReport(record: AiOutputReportRecord): void {
    this.aiOutputReportRecords.push(structuredClone(record));
  }

  findAiOutputReportBySubmission(
    appId: string,
    userId: string,
    submissionId: string,
  ): AiOutputReportRecord | undefined {
    return structuredClone(
      this.aiOutputReportRecords.find(
        (item) =>
          item.appId === appId &&
          item.userId === userId &&
          item.submissionId === submissionId,
      ),
    );
  }

  findAiOutputReportById(
    appId: string,
    reportId: string,
  ): AiOutputReportRecord | undefined {
    return structuredClone(
      this.aiOutputReportRecords.find(
        (item) => item.appId === appId && item.id === reportId,
      ),
    );
  }

  listAiOutputReports(filter: {
    appId: string;
    userId?: string;
    category?: AiOutputReportRecord["category"];
    status?: AiOutputReportRecord["status"];
    createdAtFromIso?: string;
    limit?: number;
  }): AiOutputReportRecord[] {
    const records = structuredClone(this.aiOutputReportRecords)
      .filter((item) => item.appId === filter.appId)
      .filter((item) => (filter.userId ? item.userId === filter.userId : true))
      .filter((item) =>
        filter.category ? item.category === filter.category : true
      )
      .filter((item) => (filter.status ? item.status === filter.status : true))
      .filter((item) =>
        filter.createdAtFromIso
          ? item.createdAt >= filter.createdAtFromIso
          : true
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return typeof filter.limit === "number" && filter.limit > 0
      ? records.slice(0, Math.min(Math.floor(filter.limit), 500))
      : records;
  }

  updateAiOutputReportStatus(
    appId: string,
    reportId: string,
    status: AiOutputReportRecord["status"],
    resolutionCode?: string,
    resolutionNote?: string,
  ): AiOutputReportRecord | undefined {
    const record = this.aiOutputReportRecords.find(
      (item) => item.appId === appId && item.id === reportId,
    );
    if (!record) {
      return undefined;
    }
    const now = new Date().toISOString();
    record.status = status;
    record.resolutionCode = resolutionCode;
    record.resolutionNote = resolutionNote;
    record.updatedAt = now;
    record.resolvedAt =
      status === "resolved" || status === "rejected" ? now : undefined;
    return structuredClone(record);
  }

  insertAiOutputReaction(record: AiOutputReactionRecord): void {
    this.aiOutputReactionRecords.push(structuredClone(record));
  }

  findAiOutputReactionBySubmission(
    appId: string,
    userId: string,
    submissionId: string,
  ): AiOutputReactionRecord | undefined {
    return structuredClone(
      this.aiOutputReactionRecords.find(
        (item) =>
          item.appId === appId &&
          item.userId === userId &&
          item.submissionId === submissionId,
      ),
    );
  }

  get aiNovelStatisticsSnapshots(): AiNovelStatisticsSnapshotRecord[] {
    return this.aiNovelStatistics.snapshots;
  }

  get aiNovelDailyStatistics(): AiNovelDailyStatisticsRecord[] {
    return this.aiNovelStatistics.dailyStatistics;
  }

  upsertAiNovelStatisticsSnapshot(record: AiNovelStatisticsSnapshotRecord): void {
    this.aiNovelStatistics.upsertSnapshot(record);
  }

  findAiNovelStatisticsSnapshot(
    appId: string,
    userId: string,
  ): AiNovelStatisticsSnapshotRecord | undefined {
    return this.aiNovelStatistics.findSnapshot(appId, userId);
  }

  replaceAiNovelDailyWritingStats(
    appId: string,
    userId: string,
    records: AiNovelDailyStatisticsRecord[],
    updatedAt: string,
  ): void {
    this.aiNovelStatistics.replaceDailyWritingStats(appId, userId, records, updatedAt);
  }

  incrementAiNovelDailyTokenUsage(
    appId: string,
    userId: string,
    date: string,
    tokens: number,
    updatedAt: string,
  ): void {
    this.aiNovelStatistics.incrementTokenUsage(appId, userId, date, tokens, updatedAt);
  }

  listAiNovelDailyStatistics(filter: {
    appId: string;
    userId: string;
    dateFrom?: string;
    dateTo?: string;
  }): AiNovelDailyStatisticsRecord[] {
    return this.aiNovelStatistics.listDailyStatistics(filter);
  }

  get seedManagedState(): ManagedStateSnapshot {
    return buildManagedStateSnapshot({
      apps: this.apps,
      roles: this.roles,
      rolePermissions: this.rolePermissions,
      appConfigs: this.appConfigs,
    });
  }
}
