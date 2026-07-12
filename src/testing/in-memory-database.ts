import { AsyncLocalStorage } from "node:async_hooks";
import type {
  AnalyticsEventRecord,
  AiNovelDailyStatisticsRecord,
  AiNovelStatisticsSnapshotRecord,
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
  NotificationJobRecord,
  PermissionRecord,
  RolePermissionRecord,
  RoleRecord,
  UserRecord,
  UserRoleRecord,
  SmsVerificationRecord,
} from "../shared/types.ts";
import {
  ApplicationDatabase,
  buildManagedStateSnapshot,
  type ManagedStateSnapshot,
} from "../infrastructure/database/application-database.ts";

function normalizeListLimit(limit?: number): number {
  return Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit as number), 500)) : 100;
}

/**
 * InMemoryDatabase is a test-only database double.
 */
export class InMemoryDatabase extends ApplicationDatabase {
  private readonly exclusiveContext = new AsyncLocalStorage<boolean>();
  private exclusiveTail: Promise<void> = Promise.resolve();

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
  aiNovelStatisticsSnapshots: AiNovelStatisticsSnapshotRecord[];
  aiNovelDailyStatistics: AiNovelDailyStatisticsRecord[];

  constructor(seed: DatabaseSeed = {}) {
    super();
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
    this.aiNovelStatisticsSnapshots = structuredClone(seed.aiNovelStatisticsSnapshots ?? []);
    this.aiNovelDailyStatistics = structuredClone(seed.aiNovelDailyStatistics ?? []);
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
    this.aiNovelStatisticsSnapshots = this.aiNovelStatisticsSnapshots.filter((item) => item.appId !== appId);
    this.aiNovelDailyStatistics = this.aiNovelDailyStatistics.filter((item) => item.appId !== appId);
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
    accountRegion: "CN" | "GLOBAL",
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
    this.aiNovelStatisticsSnapshots = this.aiNovelStatisticsSnapshots.filter(
      (item) => item.appId !== appId || item.userId !== userId,
    );
    this.aiNovelDailyStatistics = this.aiNovelDailyStatistics.filter(
      (item) => item.appId !== appId || item.userId !== userId,
    );
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

  upsertAiNovelStatisticsSnapshot(record: AiNovelStatisticsSnapshotRecord): void {
    const index = this.aiNovelStatisticsSnapshots.findIndex(
      (item) => item.appId === record.appId && item.userId === record.userId,
    );
    if (index >= 0) {
      this.aiNovelStatisticsSnapshots[index] = structuredClone(record);
      return;
    }
    this.aiNovelStatisticsSnapshots.push(structuredClone(record));
  }

  findAiNovelStatisticsSnapshot(
    appId: string,
    userId: string,
  ): AiNovelStatisticsSnapshotRecord | undefined {
    return structuredClone(
      this.aiNovelStatisticsSnapshots.find(
        (item) => item.appId === appId && item.userId === userId,
      ),
    );
  }

  upsertAiNovelDailyWritingStats(records: AiNovelDailyStatisticsRecord[]): void {
    for (const record of records) {
      const existing = this.aiNovelDailyStatistics.find(
        (item) =>
          item.appId === record.appId &&
          item.userId === record.userId &&
          item.date === record.date,
      );
      if (existing) {
        existing.words = record.words;
        existing.active = record.active;
        existing.updatedAt = record.updatedAt;
      } else {
        this.aiNovelDailyStatistics.push(structuredClone(record));
      }
    }
  }

  incrementAiNovelDailyTokenUsage(
    appId: string,
    userId: string,
    date: string,
    tokens: number,
    updatedAt: string,
  ): void {
    const existing = this.aiNovelDailyStatistics.find(
      (item) => item.appId === appId && item.userId === userId && item.date === date,
    );
    if (existing) {
      existing.tokens += Math.max(0, Math.floor(tokens));
      existing.updatedAt = updatedAt;
      return;
    }
    this.aiNovelDailyStatistics.push({
      appId,
      userId,
      date,
      words: 0,
      tokens: Math.max(0, Math.floor(tokens)),
      active: false,
      updatedAt,
    });
  }

  listAiNovelDailyStatistics(filter: {
    appId: string;
    userId: string;
    dateFrom?: string;
    dateTo?: string;
  }): AiNovelDailyStatisticsRecord[] {
    return structuredClone(this.aiNovelDailyStatistics)
      .filter((item) => item.appId === filter.appId && item.userId === filter.userId)
      .filter((item) => filter.dateFrom ? item.date >= filter.dateFrom : true)
      .filter((item) => filter.dateTo ? item.date <= filter.dateTo : true)
      .sort((left, right) => left.date.localeCompare(right.date));
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
