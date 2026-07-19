import { AsyncLocalStorage } from "node:async_hooks";
import type {
  AnalyticsEventRecord,
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
  FrogSleepBuddyInvitationDomainDecisionRecord,
  FrogSleepBuddyInvitationReceiptAttemptRecord,
  FrogSleepBuddyDomainSlotRecord,
  FrogSleepBuddyDomainRelationshipRecord,
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
import { conflict } from "../shared/errors.ts";

function normalizeListLimit(limit?: number): number {
  return Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit as number), 500)) : 100;
}

/**
 * InMemoryDatabase is a test-only database double.
 */
export class InMemoryDatabase extends ApplicationDatabase {
  private readonly exclusiveContext = new AsyncLocalStorage<boolean>();
  private exclusiveTail: Promise<void> = Promise.resolve();
  private readonly buddyCommandContext = new AsyncLocalStorage<Set<string>>();
  private buddyCommandTail: Promise<void> = Promise.resolve();
  private readonly buddyDecisionSafetyContext = new AsyncLocalStorage<string>();
  private readonly buddyDecisionSafetyTails = new Map<string, Promise<void>>();

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
  frogSleepBuddyInvitationDomainDecisions: FrogSleepBuddyInvitationDomainDecisionRecord[];
  frogSleepBuddyDomainSlots: FrogSleepBuddyDomainSlotRecord[];
  frogSleepBuddyDomainRelationships: FrogSleepBuddyDomainRelationshipRecord[];
  frogSleepBuddyInvitationReceiptAttempts: FrogSleepBuddyInvitationReceiptAttemptRecord[];
  frogSleepBuddyNotificationOutbox: FrogSleepBuddyNotificationOutboxRecord[];
  frogSleepBuddyNotifications: FrogSleepBuddyNotificationRecord[];
  frogSleepBuddyNotificationDeliveries: FrogSleepBuddyNotificationDeliveryRecord[];

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
    this.frogSleepDevices = [];
    this.frogSleepEntities = [];
    this.frogSleepBuddySharingGrants = [];
    this.frogSleepBuddyInvitationBundles = [];
    this.frogSleepBuddyInvitationDomainDecisions = structuredClone(seed.frogSleepBuddyInvitationDomainDecisions ?? []);
    this.frogSleepBuddyDomainSlots = structuredClone(seed.frogSleepBuddyDomainSlots ?? []);
    this.frogSleepBuddyDomainRelationships = structuredClone(seed.frogSleepBuddyDomainRelationships ?? []);
    this.frogSleepBuddyInvitationReceiptAttempts = structuredClone(seed.frogSleepBuddyInvitationReceiptAttempts ?? []);
    this.frogSleepBuddyNotificationOutbox = [];
    this.frogSleepBuddyNotifications = [];
    this.frogSleepBuddyNotificationDeliveries = [];
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
    const previous = this.buddyDecisionSafetyTails.get(serialized) ?? Promise.resolve();
    let release = () => undefined;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.buddyDecisionSafetyTails.set(serialized, current);
    await previous;
    const snapshot = this.snapshotCollections();
    try {
      return await this.buddyDecisionSafetyContext.run(serialized, async () => await fn());
    } catch (error) {
      this.restoreCollections(snapshot);
      throw error;
    } finally {
      release();
      if (this.buddyDecisionSafetyTails.get(serialized) === current) this.buddyDecisionSafetyTails.delete(serialized);
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
  }): FrogSleepBuddyInvitationBundleRecord[] {
    return structuredClone(this.frogSleepBuddyInvitationBundles).filter((item) => item.appId === input.appId &&
      (input.direction === "incoming" ? item.inviteeUserId === input.userId : item.inviterUserId === input.userId))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
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

  get seedManagedState(): ManagedStateSnapshot {
    return buildManagedStateSnapshot({
      apps: this.apps,
      roles: this.roles,
      rolePermissions: this.rolePermissions,
      appConfigs: this.appConfigs,
    });
  }
}
