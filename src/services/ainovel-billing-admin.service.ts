import { ApplicationError } from "../shared/errors.ts";
import type { AiNovelBillingTier } from "../shared/types.ts";
import { REVENUECAT_ENTITLEMENT_IDS } from "../modules/billing/ainovel-revenuecat-entitlements.ts";
import type {
  AiNovelBillingAdminEvent,
  AiNovelBillingAdminEventFilter,
  AiNovelBillingAdminOrder,
  AiNovelBillingAdminOrderDetail,
  AiNovelBillingAdminEventPage,
  AiNovelBillingAdminOrderFilter,
  AiNovelBillingAdminOrderPage,
  AiNovelBillingAdminStatus,
  AiNovelBillingAdminTransaction,
  AiNovelBillingTransactionRecord,
} from "../shared/types.ts";
import { ApplicationDatabase } from "../infrastructure/database/application-database.ts";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_CURSOR_LENGTH = 512;
const STATUSES = new Set<AiNovelBillingAdminStatus>([
  "provider_paid",
  "entitlement_active",
  "expired",
  "refunded",
  "revoked",
  "unknown",
]);

interface OrderCursor {
  observedAt: string;
  providerTransactionId: string;
  userId: string;
}

interface EventCursor {
  processedAt: string;
  eventId: string;
}

export class AiNovelBillingAdminService {
  constructor(private readonly database: ApplicationDatabase) {}

  async listOrders(query: Record<string, string | undefined>): Promise<AiNovelBillingAdminOrderPage> {
    const filter = parseOrderFilter(query);
    const rows = await this.database.listAiNovelBillingAdminOrders({
      ...filter,
      limit: filter.limit + 1,
    });
    const hasMore = rows.length > filter.limit;
    const items = rows.slice(0, filter.limit);
    const last = items.at(-1);
    return {
      items: items.map(toAdminOrder),
      nextCursor: hasMore && last ? encodeCursor({
        observedAt: last.observedAt,
        providerTransactionId: last.providerTransactionId,
        userId: last.userId,
      }) : null,
    };
  }

  async getOrder(input: {
    paymentId: string;
    eventsCursor?: string;
    eventsLimit?: string;
  }): Promise<AiNovelBillingAdminOrderDetail> {
    const paymentId = boundedQueryString(input.paymentId, "paymentId", 512);
    const transaction = await this.database.findAiNovelBillingAdminOrder({
      appId: "ai_novel",
      paymentId,
    });
    if (!transaction) {
      throw new ApplicationError(404, "BILLING_ORDER_NOT_FOUND", "Billing order was not found.");
    }

    const eventsLimit = parseLimit(input.eventsLimit, 50);
    const eventsAfter = input.eventsCursor ? decodeEventCursor(input.eventsCursor) : undefined;
    const eventPage = await this.database.listAiNovelBillingAdminEvents({
      appId: "ai_novel",
      userId: transaction.userId,
      providerTransactionId: transaction.providerTransactionId,
      after: eventsAfter,
      limit: eventsLimit,
    });
    const membership = await this.database.findAiNovelBillingMembership("ai_novel", transaction.userId);
    const membershipExpired = membership?.active === true &&
      membership.expiresAt !== null &&
      Date.parse(membership.expiresAt) <= Date.now();
    return {
      order: toAdminOrder(transaction),
      currentMembership: membership ? {
        active: membership.active && !membershipExpired,
        state: membershipExpired ? "expired" : membership.state,
        tier: membership.tier,
        planKey: membership.planKey,
        expiresAt: membership.expiresAt,
        autoRenew: membership.autoRenew,
        source: membership.source,
        lastSyncedAt: membership.lastSyncedAt,
        deletedAt: membership.accountDeletedAt,
      } : null,
      transactions: [toAdminTransaction(transaction)],
      entitlementGrants: [],
      events: eventPage.items.map(toAdminEvent),
      eventsNextCursor: eventPage.nextCursor ? encodeCursor(parseRawEventCursor(eventPage.nextCursor)) : null,
    };
  }
}

function parseOrderFilter(query: Record<string, string | undefined>): AiNovelBillingAdminOrderFilter {
  const limit = parseLimit(query.limit, DEFAULT_LIMIT);
  const cursor = query.cursor ? decodeOrderCursor(query.cursor) : undefined;
  const provider = query.provider;
  if (provider && provider !== "revenuecat") invalidQuery("provider only supports revenuecat.");
  if (query.checkoutId) invalidQuery("checkoutId is not available for RevenueCat orders.");
  const platform = query.platform;
  if (platform && !["ios", "android", "macos"].includes(platform)) {
    invalidQuery("platform must be ios, android, or macos.");
  }
  const distribution = query.distribution;
  if (distribution && !["app_store", "google_play"].includes(distribution)) {
    invalidQuery("distribution must be app_store or google_play.");
  }
  const status = query.status;
  if (status && !STATUSES.has(status as AiNovelBillingAdminStatus)) {
    invalidQuery("status is not supported.");
  }
  const createdFrom = queryDate(query.createdFrom, "createdFrom");
  const createdTo = queryDate(query.createdTo, "createdTo");
  if (createdFrom && createdTo && Date.parse(createdFrom) > Date.parse(createdTo)) {
    invalidQuery("createdFrom must not be later than createdTo.");
  }
  return {
    appId: "ai_novel",
    userId: optionalBoundedQueryString(query.userId, "userId", 128),
    paymentId: optionalBoundedQueryString(query.paymentId, "paymentId", 512),
    providerTransactionId: optionalBoundedQueryString(query.providerTransactionId, "providerTransactionId", 256),
    provider: provider as "revenuecat" | undefined,
    platform: platform as "ios" | "android" | "macos" | undefined,
    distribution: distribution as "app_store" | "google_play" | undefined,
    status: status as AiNovelBillingAdminStatus | undefined,
    createdFrom,
    createdTo,
    after: cursor,
    limit,
  };
}

function parseLimit(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) invalidQuery("limit must be an integer.");
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    invalidQuery(`limit must be between 1 and ${MAX_LIMIT}.`);
  }
  return parsed;
}

function queryDate(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) invalidQuery(`${name} must be a valid date-time.`);
  return new Date(time).toISOString();
}

function optionalBoundedQueryString(
  value: string | undefined,
  name: string,
  maxLength: number,
): string | undefined {
  return value === undefined ? undefined : boundedQueryString(value, name, maxLength);
}

function boundedQueryString(value: string, name: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    invalidQuery(`${name} must contain between 1 and ${maxLength} characters.`);
  }
  return normalized;
}

function decodeOrderCursor(value: string): OrderCursor {
  const cursor = decodeCursor(value);
  if (!isOrderCursor(cursor)) invalidQuery("cursor is invalid.");
  return cursor;
}

function decodeEventCursor(value: string): EventCursor {
  const cursor = decodeCursor(value);
  if (!isEventCursor(cursor)) invalidQuery("eventsCursor is invalid.");
  return cursor;
}

function decodeCursor(value: string): unknown {
  if (value.length > MAX_CURSOR_LENGTH) invalidQuery("cursor is too long.");
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function isOrderCursor(value: unknown): value is OrderCursor {
  if (!value || typeof value !== "object") return false;
  const cursor = value as Record<string, unknown>;
  return validDate(cursor.observedAt) && typeof cursor.providerTransactionId === "string" &&
    cursor.providerTransactionId.length > 0 && cursor.providerTransactionId.length <= 256 &&
    typeof cursor.userId === "string" && cursor.userId.length > 0 && cursor.userId.length <= 128;
}

function isEventCursor(value: unknown): value is EventCursor {
  if (!value || typeof value !== "object") return false;
  const cursor = value as Record<string, unknown>;
  return validDate(cursor.processedAt) && typeof cursor.eventId === "string" &&
    cursor.eventId.length > 0 && cursor.eventId.length <= 256;
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function encodeCursor(value: object): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function parseRawEventCursor(value: string): EventCursor {
  const separator = value.indexOf("|");
  if (separator <= 0) invalidQuery("event cursor from storage is invalid.");
  return { processedAt: value.slice(0, separator), eventId: value.slice(separator + 1) };
}

function invalidQuery(message: string): never {
  throw new ApplicationError(400, "REQ_INVALID_QUERY", message);
}

function toAdminOrder(record: AiNovelBillingTransactionRecord): AiNovelBillingAdminOrder {
  const [tierValue, period] = record.productKey.split("_");
  const tier = tierValue as AiNovelBillingTier;
  const paidAt = record.purchasedAt;
  const expiresAt = record.expiresAt;
  const durationSeconds = paidAt && expiresAt
    ? Math.max(0, Math.floor((Date.parse(expiresAt) - Date.parse(paidAt)) / 1_000))
    : null;
  return {
    paymentId: `${record.userId}:${record.providerTransactionId}`,
    appId: "ai_novel",
    userId: record.userId,
    accountRegion: "UNKNOWN",
    platform: record.platform,
    distribution: record.source === "app_store" ? "app_store" : "google_play",
    provider: "revenuecat",
    productKey: record.productKey,
    entitlementKey: tier,
    tier,
    billingPeriod: period === "monthly" ? "P1M" : period === "quarterly" ? "P3M" : period === "yearly" ? "P1Y" : null,
    purchaseSource: record.source,
    catalogRevision: null,
    providerProductId: record.productId,
    providerPackageId: null,
    providerEntitlementId: REVENUECAT_ENTITLEMENT_IDS[tier],
    durationSeconds,
    amountMinor: record.amountMinor,
    currency: record.currency,
    paymentStatus: paymentStatusFrom(record),
    entitlementStatus: entitlementStatusFrom(record.status),
    checkoutId: null,
    providerOrderId: null,
    providerTransactionId: record.providerTransactionId,
    environment: record.isSandbox === null ? null : record.isSandbox ? "SANDBOX" : "PRODUCTION",
    paidAt,
    expiresAt,
    deletedAt: record.accountDeletedAt,
    redactedAt: null,
    createdAt: paidAt ?? record.observedAt,
    updatedAt: record.observedAt,
  };
}

function toAdminTransaction(record: AiNovelBillingTransactionRecord): AiNovelBillingAdminTransaction {
  const transactionKind = record.status === "refunded"
    ? "refund"
    : record.status === "revoked"
      ? "revoke"
      : record.purchasedAt && record.originalPurchaseDate && record.purchasedAt !== record.originalPurchaseDate
        ? "renewal"
        : "purchase";
  return {
    transactionId: record.providerTransactionId,
    provider: "revenuecat",
    transactionKind,
    providerOrderId: null,
    providerTransactionId: record.providerTransactionId,
    relatedTransactionId: null,
    providerRefundId: null,
    refundAmountMinor: record.refundAmountMinor,
    refundReason: null,
    status: paymentStatusFrom(record),
    amountMinor: record.amountMinor,
    currency: record.currency,
    occurredAt: record.purchasedAt ?? record.observedAt,
  };
}

function paymentStatusFrom(
  record: AiNovelBillingTransactionRecord,
): AiNovelBillingAdminOrder["paymentStatus"] {
  if (record.status === "refunded") return "refunded";
  // RC entitlement snapshots and trial events are not proof of a charge.
  return record.amountMinor !== null && record.amountMinor > 0 ? "provider_paid" : "unknown";
}

function entitlementStatusFrom(
  status: AiNovelBillingTransactionRecord["status"],
): AiNovelBillingAdminOrder["entitlementStatus"] {
  if (status === "entitlement_active") return "active";
  if (status === "expired") return "expired";
  if (status === "revoked") return "revoked";
  return "unknown";
}

function toAdminEvent(record: AiNovelBillingAdminEventPage["items"][number]): AiNovelBillingAdminEvent {
  return {
    eventId: `${record.userId ?? "unknown"}:${record.eventId}`,
    appId: "ai_novel",
    provider: "revenuecat",
    source: "webhook",
    eventType: record.eventType,
    providerEventId: record.eventId,
    affectedUserIds: record.affectedUserIds,
    verificationResult: "verified",
    processingStatus: record.status,
    occurredAt: record.occurredAt,
    processedAt: record.processedAt,
    accountDeletedAt: record.accountDeletedAt,
  };
}
