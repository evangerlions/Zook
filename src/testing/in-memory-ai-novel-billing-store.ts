import type {
  AiNovelBillingAdminEventFilter,
  AiNovelBillingAdminEventPage,
  AiNovelBillingAdminOrderDetailFilter,
  AiNovelBillingAdminOrderFilter,
  AiNovelBillingMembershipRecord,
  AiNovelBillingTransactionRecord,
  AiNovelBillingWebhookEventRecord,
  DatabaseSeed,
} from "../shared/types.ts";

function splitPaymentId(value: string): [string, string] | undefined {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) return undefined;
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function preferCurrentOrBackfill<T>(
  current: T | null,
  incoming: T | null,
  isCurrentObservation: boolean,
): T | null {
  return isCurrentObservation ? incoming ?? current : current ?? incoming;
}

function matchesAdminStatus(
  transaction: AiNovelBillingTransactionRecord,
  status: AiNovelBillingAdminOrderFilter["status"],
): boolean {
  if (!status) return true;
  if (status === "provider_paid") {
    return transaction.status !== "refunded" &&
      transaction.amountMinor !== null && transaction.amountMinor > 0;
  }
  if (status === "unknown") {
    return transaction.status !== "refunded" &&
      (transaction.amountMinor === null || transaction.amountMinor <= 0);
  }
  return transaction.status === status;
}

export class InMemoryAiNovelBillingStore {
  readonly memberships: AiNovelBillingMembershipRecord[];
  readonly transactions: AiNovelBillingTransactionRecord[];
  readonly webhookEvents: AiNovelBillingWebhookEventRecord[];

  constructor(seed: Pick<DatabaseSeed,
    "aiNovelBillingMemberships" | "aiNovelBillingTransactions" | "aiNovelBillingWebhookEvents"
  > = {}) {
    this.memberships = structuredClone(seed.aiNovelBillingMemberships ?? []);
    this.transactions = structuredClone(seed.aiNovelBillingTransactions ?? []);
    this.webhookEvents = structuredClone(seed.aiNovelBillingWebhookEvents ?? []);
  }

  findMembership(appId: "ai_novel", userId: string): AiNovelBillingMembershipRecord | undefined {
    const record = this.memberships.find((item) => item.appId === appId && item.userId === userId);
    return record ? structuredClone(record) : undefined;
  }

  upsertMembership(record: AiNovelBillingMembershipRecord): void {
    const index = this.memberships.findIndex(
      (item) => item.appId === record.appId && item.userId === record.userId,
    );
    const existing = this.memberships[index];
    if (existing && existing.lastSyncedAt > record.lastSyncedAt) return;
    const next = structuredClone(record);
    if (index < 0) this.memberships.push(next);
    else this.memberships[index] = next;
  }

  upsertTransaction(record: AiNovelBillingTransactionRecord): void {
    const index = this.transactions.findIndex(
      (item) => item.appId === record.appId && item.userId === record.userId &&
        item.providerTransactionId === record.providerTransactionId,
    );
    const existing = this.transactions[index];
    const isCurrentObservation = !existing || existing.observedAt <= record.observedAt;
    const next = structuredClone(isCurrentObservation ? record : existing);
    if (existing) {
      next.platform = preferCurrentOrBackfill(existing.platform, record.platform, isCurrentObservation);
      next.amountMinor = preferCurrentOrBackfill(existing.amountMinor, record.amountMinor, isCurrentObservation);
      next.refundAmountMinor = preferCurrentOrBackfill(existing.refundAmountMinor, record.refundAmountMinor, isCurrentObservation);
      next.currency = preferCurrentOrBackfill(existing.currency, record.currency, isCurrentObservation);
      next.observedAt = isCurrentObservation ? record.observedAt : existing.observedAt;
      next.accountDeletedAt ??= existing.accountDeletedAt;
    }
    if (index < 0) this.transactions.push(next);
    else this.transactions[index] = next;
  }

  listTransactions(appId: "ai_novel", userId: string): AiNovelBillingTransactionRecord[] {
    return structuredClone(this.transactions.filter(
      (item) => item.appId === appId && item.userId === userId,
    ));
  }

  listAdminOrders(filter: AiNovelBillingAdminOrderFilter): AiNovelBillingTransactionRecord[] {
    if (filter.provider && filter.provider !== "revenuecat") return [];
    if (filter.paymentId && !filter.paymentId.includes(":")) return [];
    return structuredClone(this.transactions
      .filter((item) => item.appId === filter.appId)
      .filter((item) => !filter.userId || item.userId === filter.userId)
      .filter((item) => !filter.providerTransactionId || item.providerTransactionId === filter.providerTransactionId)
      .filter((item) => !filter.paymentId || `${item.userId}:${item.providerTransactionId}` === filter.paymentId)
      .filter((item) => !filter.platform || item.platform === filter.platform)
      .filter((item) => !filter.distribution || item.source === (filter.distribution === "google_play" ? "play_store" : "app_store"))
      .filter((item) => matchesAdminStatus(item, filter.status))
      .filter((item) => !filter.createdFrom || Date.parse(item.purchasedAt ?? item.observedAt) >= Date.parse(filter.createdFrom))
      .filter((item) => !filter.createdTo || Date.parse(item.purchasedAt ?? item.observedAt) <= Date.parse(filter.createdTo))
      .filter((item) => !filter.after || Date.parse(item.observedAt) < Date.parse(filter.after.observedAt) ||
        (item.observedAt === filter.after.observedAt &&
          (item.providerTransactionId > filter.after.providerTransactionId ||
            (item.providerTransactionId === filter.after.providerTransactionId && item.userId > filter.after.userId))))
      .sort((left, right) => right.observedAt.localeCompare(left.observedAt) ||
        left.providerTransactionId.localeCompare(right.providerTransactionId) ||
        left.userId.localeCompare(right.userId))
      .slice(0, filter.limit));
  }

  findAdminOrder(filter: AiNovelBillingAdminOrderDetailFilter): AiNovelBillingTransactionRecord | undefined {
    const parsed = splitPaymentId(filter.paymentId);
    if (!parsed) return undefined;
    const [userId, providerTransactionId] = parsed;
    const row = this.transactions.find((item) => item.appId === filter.appId &&
      item.userId === userId && item.providerTransactionId === providerTransactionId);
    return row ? structuredClone(row) : undefined;
  }

  listAdminEvents(filter: AiNovelBillingAdminEventFilter): AiNovelBillingAdminEventPage {
    const rows = this.webhookEvents
      .filter((item) => item.appId === filter.appId &&
        (item.userId === filter.userId || item.affectedUserIds.includes(filter.userId)) &&
        (item.providerTransactionId === filter.providerTransactionId ||
          (item.eventType === "TRANSFER" && item.providerTransactionId === null)))
      .filter((item) => !filter.after || Date.parse(item.processedAt) < Date.parse(filter.after.processedAt) ||
        (item.processedAt === filter.after.processedAt && item.eventId > filter.after.eventId))
      .sort((left, right) => right.processedAt.localeCompare(left.processedAt) || left.eventId.localeCompare(right.eventId));
    const page = rows.slice(0, filter.limit + 1);
    const hasMore = page.length > filter.limit;
    const items = page.slice(0, filter.limit);
    const last = items.at(-1);
    return {
      items: structuredClone(items),
      nextCursor: hasMore && last ? `${last.processedAt}|${last.eventId}` : null,
    };
  }

  findWebhookEvent(appId: "ai_novel", eventId: string): AiNovelBillingWebhookEventRecord | undefined {
    const record = this.webhookEvents.find((item) => item.appId === appId && item.eventId === eventId);
    return record ? structuredClone(record) : undefined;
  }

  insertWebhookEvent(record: AiNovelBillingWebhookEventRecord): boolean {
    if (this.findWebhookEvent(record.appId, record.eventId)) return false;
    this.webhookEvents.push(structuredClone(record));
    return true;
  }

  softDeleteAccount(appId: "ai_novel", userId: string, deletedAt: string): void {
    const membership = this.memberships.find((item) => item.appId === appId && item.userId === userId);
    if (membership) {
      Object.assign(membership, {
        active: false,
        state: "free",
        tier: null,
        planKey: null,
        expiresAt: null,
        autoRenew: null,
        source: null,
        managementUrl: null,
        accountDeletedAt: deletedAt,
        lastSyncedAt: deletedAt,
      });
    }
    for (const transaction of this.transactions) {
      if (transaction.appId === appId && transaction.userId === userId) {
        transaction.accountDeletedAt = deletedAt;
      }
    }
    for (const event of this.webhookEvents) {
      if (event.appId === appId &&
          (event.userId === userId || event.affectedUserIds.includes(userId))) {
        event.accountDeletedAt ??= deletedAt;
      }
    }
  }
}
