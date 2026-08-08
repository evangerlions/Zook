import type {
  BuddyInvitationStatus,
  BuddySharingCategory,
  BuddyInvitationDomain,
} from "./buddy-growth-contract.ts";
import type { FrogSleepBuddyInvitationBundleRecord, FrogSleepBuddyNotificationDeliveryRecord,
  FrogSleepBuddyInvitationDomainDecisionRecord, FrogSleepBuddyNotificationOutboxRecord,
  FrogSleepBuddyNotificationRecord, FrogSleepBuddyInvitationReceiptAttemptRecord,
  FrogSleepBuddyDomainSlotRecord } from "../../../shared/types.ts";
import { assertValidFrogSleepBuddyDomainSlot } from "./buddy-domain-slot-validation.ts";
import type { FrogSleepBuddyDomainRelationshipRecord } from "../../../shared/types.ts";
import {
  normalizeFrogSleepBuddyDomainRelationship,
  normalizeFrogSleepBuddyDomainRelationshipUpdate,
  type FrogSleepBuddyDomainRelationshipUpdate,
} from "./buddy-domain-relationship-validation.ts";

export interface BuddySharingGrantRecord {
  id: string;
  appId: string;
  relationshipId: string;
  grantorUserId: string;
  granteeUserId: string;
  domain: Exclude<BuddyInvitationDomain, "bundle">;
  category: BuddySharingCategory;
  state: "granted" | "revoked";
  version: number;
  grantedAt?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BuddyInvitationReceiptRecord {
  id: string;
  appId: string;
  invitationKind: "sleep_invite" | "focus_invite" | "bundle";
  invitationId: string;
  bundleId?: string;
  inviterUserId: string;
  inviteeUserId?: string;
  status: BuddyInvitationStatus;
  version: number;
  recipientReadAt?: string;
  senderReadAt?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export type BuddyInvitationBundleRecord = FrogSleepBuddyInvitationBundleRecord;

export type BuddyNotificationOutboxRecord = FrogSleepBuddyNotificationOutboxRecord;

export interface BuddyInvitationPage {
  items: BuddyInvitationReceiptRecord[];
  nextCursor?: string;
}

export interface BuddyGrowthRepositoryProtocol {
  upsertGrant(record: BuddySharingGrantRecord): Promise<BuddySharingGrantRecord>;
  listGrantsForViewer(appId: string, granteeUserId: string, relationshipId: string): Promise<BuddySharingGrantRecord[]>;
  listGrants(appId: string, relationshipId: string): Promise<BuddySharingGrantRecord[]>;
  findGrant(appId: string, grantId: string): Promise<BuddySharingGrantRecord | undefined>;
  updateGrant(appId: string, grantId: string, expectedVersion: number, state: BuddySharingGrantRecord["state"]): Promise<BuddySharingGrantRecord | undefined>;
  upsertInvitationReceipt(record: BuddyInvitationReceiptRecord): Promise<BuddyInvitationReceiptRecord>;
  upsertBundle(record: BuddyInvitationBundleRecord): Promise<BuddyInvitationBundleRecord>;
  findBundle(appId: string, bundleId: string): Promise<BuddyInvitationBundleRecord | undefined>;
  listBundles(input: { appId: string; userId: string; direction: "incoming" | "outgoing" }): Promise<BuddyInvitationBundleRecord[]>;
  upsertInvitationDomainDecision(record: FrogSleepBuddyInvitationDomainDecisionRecord): Promise<FrogSleepBuddyInvitationDomainDecisionRecord>;
  findInvitationDomainDecision(appId: string, invitationId: string, domain: FrogSleepBuddyInvitationDomainDecisionRecord["domain"]): Promise<FrogSleepBuddyInvitationDomainDecisionRecord | undefined>;
  listInvitationDomainDecisions(appId: string, invitationId: string): Promise<FrogSleepBuddyInvitationDomainDecisionRecord[]>;
  compareAndUpdateInvitationDomainDecision(input: {
    appId: string; invitationId: string; domain: FrogSleepBuddyInvitationDomainDecisionRecord["domain"];
    expectedVersion: number; status: FrogSleepBuddyInvitationDomainDecisionRecord["status"];
    decidedByUserId: string; decidedAt: string; idempotencyKeyHash: string; updatedAt: string;
  }): Promise<FrogSleepBuddyInvitationDomainDecisionRecord | undefined>;
  ensureDomainSlot(input: { appId: string; userId: string; domain: FrogSleepBuddyDomainSlotRecord["domain"]; now: string }): Promise<FrogSleepBuddyDomainSlotRecord>;
  findDomainSlot(appId: string, userId: string, domain: FrogSleepBuddyDomainSlotRecord["domain"]): Promise<FrogSleepBuddyDomainSlotRecord | undefined>;
  listDomainSlots(appId: string, userId: string): Promise<FrogSleepBuddyDomainSlotRecord[]>;
  compareAndUpdateDomainSlot(input: { appId: string; userId: string; domain: FrogSleepBuddyDomainSlotRecord["domain"]; expectedVersion: number; state: FrogSleepBuddyDomainSlotRecord["state"]; relationshipId?: string; updatedAt: string }): Promise<FrogSleepBuddyDomainSlotRecord | undefined>;
  insertDomainRelationship(record: FrogSleepBuddyDomainRelationshipRecord): Promise<FrogSleepBuddyDomainRelationshipRecord>;
  findDomainRelationship(appId: string, relationshipId: string): Promise<FrogSleepBuddyDomainRelationshipRecord | undefined>;
  listCurrentDomainRelationships(appId: string, userId: string, domain: FrogSleepBuddyDomainRelationshipRecord["domain"]): Promise<FrogSleepBuddyDomainRelationshipRecord[]>;
  compareAndUpdateDomainRelationship(input: FrogSleepBuddyDomainRelationshipUpdate): Promise<FrogSleepBuddyDomainRelationshipRecord | undefined>;
  upsertInvitationReceiptAttempt(record: FrogSleepBuddyInvitationReceiptAttemptRecord): Promise<FrogSleepBuddyInvitationReceiptAttemptRecord>;
  findInvitationReceiptAttempt(appId: string, inviterUserId: string, recipientIdentityHash: string, domainsFingerprint: string): Promise<FrogSleepBuddyInvitationReceiptAttemptRecord | undefined>;
  findInvitationReceiptAttemptById(appId: string, inviterUserId: string, receiptId: string): Promise<FrogSleepBuddyInvitationReceiptAttemptRecord | undefined>;
  listInvitationInbox(input: { appId: string; userId: string; limit: number; cursor?: string }): Promise<BuddyInvitationPage>;
  listInvitationOutbox(input: { appId: string; userId: string; limit: number; cursor?: string }): Promise<BuddyInvitationPage>;
  enqueueNotification(record: BuddyNotificationOutboxRecord): Promise<BuddyNotificationOutboxRecord>;
  listReadyNotifications(nowIso: string, limit: number): Promise<BuddyNotificationOutboxRecord[]>;
  updateNotificationOutbox(id: string, patch: Partial<Pick<BuddyNotificationOutboxRecord,
    "status" | "attemptCount" | "processedAt" | "lastErrorCode" | "updatedAt">>): Promise<BuddyNotificationOutboxRecord | undefined>;
  upsertNotification(record: FrogSleepBuddyNotificationRecord): Promise<FrogSleepBuddyNotificationRecord>;
  findNotification(appId: string, recipientUserId: string, notificationId: string): Promise<FrogSleepBuddyNotificationRecord | undefined>;
  listNotifications(input: { appId: string; recipientUserId: string; limit: number; cursor?: string }): Promise<{ items: FrogSleepBuddyNotificationRecord[]; nextCursor?: string }>;
  countUnreadNotifications(appId: string, recipientUserId: string): Promise<number>;
  markNotificationRead(appId: string, recipientUserId: string, notificationId: string, readAt: string): Promise<FrogSleepBuddyNotificationRecord | undefined>;
  markAllNotificationsRead(appId: string, recipientUserId: string, readAt: string): Promise<number>;
  insertNotificationDelivery(record: FrogSleepBuddyNotificationDeliveryRecord): Promise<FrogSleepBuddyNotificationDeliveryRecord>;
}

export class BuddyGrowthRepository {
  static inMemory(): BuddyGrowthRepositoryProtocol {
    return new InMemoryBuddyGrowthRepository();
  }
}

class InMemoryBuddyGrowthRepository implements BuddyGrowthRepositoryProtocol {
  private grants = new Map<string, BuddySharingGrantRecord>();
  private receipts = new Map<string, BuddyInvitationReceiptRecord>();
  private bundles = new Map<string, BuddyInvitationBundleRecord>();
  private domainDecisions = new Map<
    string,
    Map<string, Map<FrogSleepBuddyInvitationDomainDecisionRecord["domain"], FrogSleepBuddyInvitationDomainDecisionRecord>>
  >();
  private domainSlots = new Map<string, FrogSleepBuddyDomainSlotRecord>();
  private domainRelationships = new Map<string, FrogSleepBuddyDomainRelationshipRecord>();
  private receiptAttempts = new Map<string, FrogSleepBuddyInvitationReceiptAttemptRecord>();
  private notifications = new Map<string, BuddyNotificationOutboxRecord>();
  private feed = new Map<string, FrogSleepBuddyNotificationRecord>();
  private deliveries = new Map<string, FrogSleepBuddyNotificationDeliveryRecord>();

  async upsertGrant(record: BuddySharingGrantRecord): Promise<BuddySharingGrantRecord> {
    const key = [record.appId, record.relationshipId, record.grantorUserId, record.granteeUserId, record.domain, record.category].join(":");
    const existing = this.grants.get(key);
    const stored = { ...record, id: existing?.id ?? record.id };
    this.grants.set(key, stored);
    return stored;
  }

  async listGrantsForViewer(appId: string, granteeUserId: string, relationshipId: string) {
    return [...this.grants.values()].filter((item) =>
      item.appId === appId && item.granteeUserId === granteeUserId && item.relationshipId === relationshipId
    );
  }

  async listGrants(appId: string, relationshipId: string) {
    return [...this.grants.values()]
      .filter((item) => item.appId === appId && item.relationshipId === relationshipId)
      .sort((left, right) => left.grantorUserId.localeCompare(right.grantorUserId) || left.category.localeCompare(right.category));
  }

  async findGrant(appId: string, grantId: string) {
    return [...this.grants.values()].find((item) => item.appId === appId && item.id === grantId);
  }

  async updateGrant(appId: string, grantId: string, expectedVersion: number, state: BuddySharingGrantRecord["state"]) {
    const grant = await this.findGrant(appId, grantId);
    if (!grant || grant.version !== expectedVersion) return undefined;
    const now = new Date().toISOString();
    return this.upsertGrant({ ...grant, state, version: grant.version + 1, updatedAt: now,
      grantedAt: state === "granted" ? now : grant.grantedAt, revokedAt: state === "revoked" ? now : undefined });
  }

  async upsertInvitationReceipt(record: BuddyInvitationReceiptRecord) {
    const key = `${record.appId}:${record.invitationKind}:${record.invitationId}`;
    const existing = this.receipts.get(key);
    const stored = { ...record, id: existing?.id ?? record.id };
    this.receipts.set(key, stored);
    return stored;
  }

  async upsertBundle(record: BuddyInvitationBundleRecord) {
    const key = `${record.appId}:${record.id}`;
    const stored = structuredClone(record);
    this.bundles.set(key, stored);
    return structuredClone(stored);
  }

  async findBundle(appId: string, bundleId: string) {
    const record = this.bundles.get(`${appId}:${bundleId}`);
    return record ? structuredClone(record) : undefined;
  }

  async listBundles(input: { appId: string; userId: string; direction: "incoming" | "outgoing" }) {
    return [...this.bundles.values()].filter((item) => item.appId === input.appId &&
      (input.direction === "incoming" ? item.inviteeUserId === input.userId : item.inviterUserId === input.userId))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async upsertInvitationDomainDecision(record: FrogSleepBuddyInvitationDomainDecisionRecord) {
    const invitations = this.domainDecisions.get(record.appId) ?? new Map();
    const decisions = invitations.get(record.invitationId) ?? new Map();
    const existing = decisions.get(record.domain);
    const stored = { ...record, createdAt: existing?.createdAt ?? record.createdAt };
    decisions.set(record.domain, structuredClone(stored));
    invitations.set(record.invitationId, decisions);
    this.domainDecisions.set(record.appId, invitations);
    return structuredClone(stored);
  }

  async findInvitationDomainDecision(
    appId: string,
    invitationId: string,
    domain: FrogSleepBuddyInvitationDomainDecisionRecord["domain"],
  ) {
    const record = this.domainDecisions.get(appId)?.get(invitationId)?.get(domain);
    return record ? structuredClone(record) : undefined;
  }

  async listInvitationDomainDecisions(appId: string, invitationId: string) {
    return [...(this.domainDecisions.get(appId)?.get(invitationId)?.values() ?? [])]
      .sort((left, right) => left.domain.localeCompare(right.domain))
      .map((item) => structuredClone(item));
  }

  async compareAndUpdateInvitationDomainDecision(input: {
    appId: string; invitationId: string; domain: FrogSleepBuddyInvitationDomainDecisionRecord["domain"];
    expectedVersion: number; status: FrogSleepBuddyInvitationDomainDecisionRecord["status"];
    decidedByUserId: string; decidedAt: string; idempotencyKeyHash: string; updatedAt: string;
  }) {
    const existing = await this.findInvitationDomainDecision(input.appId, input.invitationId, input.domain);
    if (!existing || existing.status !== "pending" || existing.version !== input.expectedVersion) return undefined;
    return await this.upsertInvitationDomainDecision({ ...existing, status: input.status,
      version: existing.version + 1, decidedByUserId: input.decidedByUserId, decidedAt: input.decidedAt,
      idempotencyKeyHash: input.idempotencyKeyHash, terminalReason: undefined, updatedAt: input.updatedAt });
  }

  async ensureDomainSlot(input: { appId: string; userId: string; domain: FrogSleepBuddyDomainSlotRecord["domain"]; now: string }) {
    assertValidFrogSleepBuddyDomainSlot({ domain: input.domain, state: "available" });
    const key = JSON.stringify([input.appId, input.userId, input.domain]);
    const existing = this.domainSlots.get(key);
    if (existing) return structuredClone(existing);
    const slot: FrogSleepBuddyDomainSlotRecord = {
      appId: input.appId, userId: input.userId, domain: input.domain, state: "available", version: 1,
      createdAt: input.now, updatedAt: input.now,
    };
    this.domainSlots.set(key, slot);
    return structuredClone(slot);
  }

  async findDomainSlot(appId: string, userId: string, domain: FrogSleepBuddyDomainSlotRecord["domain"]) {
    const slot = this.domainSlots.get(JSON.stringify([appId, userId, domain]));
    return slot ? structuredClone(slot) : undefined;
  }

  async listDomainSlots(appId: string, userId: string) {
    return [...this.domainSlots.values()].filter((slot) => slot.appId === appId && slot.userId === userId)
      .sort((left, right) => left.domain.localeCompare(right.domain)).map((slot) => structuredClone(slot));
  }

  async compareAndUpdateDomainSlot(input: { appId: string; userId: string; domain: FrogSleepBuddyDomainSlotRecord["domain"]; expectedVersion: number; state: FrogSleepBuddyDomainSlotRecord["state"]; relationshipId?: string; updatedAt: string }) {
    assertValidFrogSleepBuddyDomainSlot(input);
    const key = JSON.stringify([input.appId, input.userId, input.domain]);
    const existing = this.domainSlots.get(key);
    if (!existing || existing.version !== input.expectedVersion) return undefined;
    const updated = { ...existing, state: input.state, relationshipId: input.relationshipId, version: existing.version + 1, updatedAt: input.updatedAt };
    this.domainSlots.set(key, updated);
    return structuredClone(updated);
  }

  async insertDomainRelationship(record: FrogSleepBuddyDomainRelationshipRecord) {
    const normalized = normalizeFrogSleepBuddyDomainRelationship(record);
    const existing = this.domainRelationships.get(normalized.id);
    if (existing) {
      if (existing.appId !== normalized.appId) throw new Error("FrogSleep buddy domain relationship ID collision.");
      return structuredClone(existing);
    }
    if (normalized.status !== "revoked" && [...this.domainRelationships.values()].some((item) =>
      item.appId === normalized.appId && item.domain === normalized.domain && item.status !== "revoked" &&
      item.userIdLow === normalized.userIdLow && item.userIdHigh === normalized.userIdHigh
    )) throw new Error("FrogSleep buddy domain relationship current pair already exists.");
    this.domainRelationships.set(normalized.id, normalized);
    return structuredClone(normalized);
  }

  async findDomainRelationship(appId: string, relationshipId: string) {
    const record = this.domainRelationships.get(relationshipId);
    return record?.appId === appId ? structuredClone(record) : undefined;
  }

  async listCurrentDomainRelationships(
    appId: string, userId: string, domain: FrogSleepBuddyDomainRelationshipRecord["domain"],
  ) {
    return [...this.domainRelationships.values()].filter((item) =>
      item.appId === appId && item.domain === domain && item.status !== "revoked" &&
      (item.userIdLow === userId || item.userIdHigh === userId)
    ).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))
      .map((item) => structuredClone(item));
  }

  async compareAndUpdateDomainRelationship(input: FrogSleepBuddyDomainRelationshipUpdate) {
    const normalizedInput = normalizeFrogSleepBuddyDomainRelationshipUpdate(input);
    const existing = this.domainRelationships.get(normalizedInput.id);
    if (!existing || existing.appId !== normalizedInput.appId || existing.version !== normalizedInput.expectedVersion) {
      return undefined;
    }
    const updated = normalizeFrogSleepBuddyDomainRelationship({
      ...existing, status: normalizedInput.status, pausedByUserIds: normalizedInput.pausedByUserIds,
      revokedAt: normalizedInput.revokedAt, version: existing.version + 1, updatedAt: normalizedInput.updatedAt,
    });
    if (updated.status !== "revoked" && [...this.domainRelationships.values()].some((item) =>
      item.id !== updated.id && item.appId === updated.appId && item.domain === updated.domain &&
      item.status !== "revoked" && item.userIdLow === updated.userIdLow && item.userIdHigh === updated.userIdHigh
    )) throw new Error("FrogSleep buddy domain relationship current pair already exists.");
    this.domainRelationships.set(updated.id, updated);
    return structuredClone(updated);
  }

  async upsertInvitationReceiptAttempt(record: FrogSleepBuddyInvitationReceiptAttemptRecord) {
    const key = JSON.stringify([record.appId, record.inviterUserId, record.recipientIdentityHash, record.domainsFingerprint]);
    const existing = this.receiptAttempts.get(key);
    const stored = existing ? { ...existing, updatedAt: record.updatedAt } : structuredClone(record);
    this.receiptAttempts.set(key, stored);
    return structuredClone(stored);
  }

  async findInvitationReceiptAttempt(appId: string, inviterUserId: string, recipientIdentityHash: string, domainsFingerprint: string) {
    const key = JSON.stringify([appId, inviterUserId, recipientIdentityHash, domainsFingerprint]);
    const record = this.receiptAttempts.get(key);
    return record ? structuredClone(record) : undefined;
  }

  async findInvitationReceiptAttemptById(appId: string, inviterUserId: string, receiptId: string) {
    const record = [...this.receiptAttempts.values()].find((item) =>
      item.appId === appId && item.inviterUserId === inviterUserId && item.id === receiptId
    );
    return record ? structuredClone(record) : undefined;
  }

  async listInvitationInbox(input: { appId: string; userId: string; limit: number; cursor?: string }) {
    return this.pageReceipts(input, (item) => item.inviteeUserId === input.userId);
  }

  async listInvitationOutbox(input: { appId: string; userId: string; limit: number; cursor?: string }) {
    return this.pageReceipts(input, (item) => item.inviterUserId === input.userId);
  }

  async enqueueNotification(record: BuddyNotificationOutboxRecord) {
    const key = `${record.appId}:${record.deduplicationKey}`;
    const existing = this.notifications.get(key);
    if (existing) return existing;
    this.notifications.set(key, record);
    return record;
  }

  async listReadyNotifications(nowIso: string, limit: number) {
    return [...this.notifications.values()]
      .filter((item) => ["pending", "failed"].includes(item.status) && item.availableAt <= nowIso)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, limit);
  }

  async updateNotificationOutbox(id: string, patch: Partial<BuddyNotificationOutboxRecord>) {
    const entry = [...this.notifications.values()].find((item) => item.id === id);
    if (!entry) return undefined;
    Object.assign(entry, patch);
    return structuredClone(entry);
  }

  async upsertNotification(record: FrogSleepBuddyNotificationRecord) {
    const key = `${record.appId}:${record.recipientUserId}:${record.outboxId}`;
    const existing = this.feed.get(key);
    if (existing) return structuredClone(existing);
    this.feed.set(key, structuredClone(record));
    return structuredClone(record);
  }

  async findNotification(appId: string, recipientUserId: string, notificationId: string) {
    const item = [...this.feed.values()].find((value) => value.appId === appId &&
      value.recipientUserId === recipientUserId && value.id === notificationId);
    return item ? structuredClone(item) : undefined;
  }

  async listNotifications(input: { appId: string; recipientUserId: string; limit: number; cursor?: string }) {
    const items = [...this.feed.values()].filter((item) => item.appId === input.appId && item.recipientUserId === input.recipientUserId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      .filter((item) => !input.cursor || `${item.createdAt}|${item.id}` < input.cursor).slice(0, input.limit);
    const last = items.at(-1);
    return { items: structuredClone(items), nextCursor: items.length === input.limit && last ? `${last.createdAt}|${last.id}` : undefined };
  }

  async countUnreadNotifications(appId: string, recipientUserId: string) {
    return [...this.feed.values()].filter((item) => item.appId === appId && item.recipientUserId === recipientUserId && !item.readAt).length;
  }

  async markNotificationRead(appId: string, recipientUserId: string, notificationId: string, readAt: string) {
    const item = [...this.feed.values()].find((value) => value.appId === appId && value.recipientUserId === recipientUserId && value.id === notificationId);
    if (!item) return undefined;
    item.readAt ??= readAt; item.updatedAt = readAt;
    return structuredClone(item);
  }

  async markAllNotificationsRead(appId: string, recipientUserId: string, readAt: string) {
    let count = 0;
    for (const item of this.feed.values()) if (item.appId === appId && item.recipientUserId === recipientUserId && !item.readAt) {
      item.readAt = readAt; item.updatedAt = readAt; count += 1;
    }
    return count;
  }

  async insertNotificationDelivery(record: FrogSleepBuddyNotificationDeliveryRecord) {
    const key = `${record.notificationId}:${record.channel}:${record.attempt}`;
    const existing = this.deliveries.get(key);
    if (existing) return structuredClone(existing);
    this.deliveries.set(key, structuredClone(record));
    return structuredClone(record);
  }

  private pageReceipts(
    input: { appId: string; limit: number; cursor?: string },
    belongsToUser: (record: BuddyInvitationReceiptRecord) => boolean,
  ): BuddyInvitationPage {
    const items = [...this.receipts.values()]
      .filter((item) => item.appId === input.appId && belongsToUser(item))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      .filter((item) => !input.cursor || `${item.createdAt}|${item.id}` < input.cursor)
      .slice(0, input.limit);
    const last = items.at(-1);
    return { items, nextCursor: items.length === input.limit && last ? `${last.createdAt}|${last.id}` : undefined };
  }
}
