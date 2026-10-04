import { timingSafeEqual } from "node:crypto";
import { ApplicationError } from "../shared/errors.ts";
import type {
  AiNovelBillingMembershipInfo,
  AiNovelBillingMembershipRecord,
  AiNovelBillingTransactionRecord,
  AiNovelBillingWebhookEventRecord,
  HttpRequest,
} from "../shared/types.ts";
import { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import { buildEmptyMembershipInfo } from "../modules/billing/billing-membership.ts";
import {
  normalizeRevenueCatSnapshot,
  normalizeRevenueCatWebhookTransaction,
  type NormalizedRevenueCatSnapshot,
} from "../modules/billing/ainovel-revenuecat-normalizer.ts";
import {
  RevenueCatApiError,
  RevenueCatCustomerApi,
  isObject,
} from "./ainovel-revenuecat-client.ts";

const APP_ID = "ai_novel" as const;
const SUPPORTED_STORES = new Set(["APP_STORE", "MAC_APP_STORE", "PLAY_STORE"]);
const REVENUECAT_SYNC_TIMEOUT_MS = 8_000;
const WEBHOOK_EVENT_ID_MAX_LENGTH = 256;
const MAX_TRANSFER_USER_IDS = 32;
const WEBHOOK_HANDLED_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
  "CANCELLATION",
  "BILLING_ISSUE",
  "SUBSCRIPTION_EXTENDED",
  "SUBSCRIPTION_PAUSED",
  "EXPIRATION",
  "REFUND_REVERSED",
  "TRANSFER",
]);

export interface AiNovelBillingServiceOptions {
  secretApiKey?: string;
  webhookAuthorization?: string;
  revenueCatAppId?: string;
  allowSandbox?: boolean;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
}

export interface AiNovelBillingSyncResult {
  syncStatus: "synchronized" | "pending";
  membership: AiNovelBillingMembershipInfo;
}

export class AiNovelBillingService {
  private readonly customerApi: RevenueCatCustomerApi;
  private readonly now: () => Date;

  constructor(
    private readonly database: ApplicationDatabase,
    options: AiNovelBillingServiceOptions,
    private readonly logger: StructuredLogger,
  ) {
    this.customerApi = new RevenueCatCustomerApi({
      secretApiKey: options.secretApiKey,
      fetcher: options.fetcher,
      timeoutMs: options.timeoutMs ?? REVENUECAT_SYNC_TIMEOUT_MS,
    });
    this.webhookAuthorization = options.webhookAuthorization?.trim();
    this.revenueCatAppId = options.revenueCatAppId?.trim();
    this.allowSandbox = options.allowSandbox ?? false;
    this.now = options.now ?? (() => new Date());
  }

  private readonly webhookAuthorization: string | undefined;
  private readonly revenueCatAppId: string | undefined;
  private readonly allowSandbox: boolean;

  async getMembership(userId: string): Promise<AiNovelBillingMembershipInfo> {
    const record = await this.database.findAiNovelBillingMembership(APP_ID, userId);
    if (!record || record.accountDeletedAt) return buildEmptyMembershipInfo();
    return toMembershipInfo(record, this.now());
  }

  async sync(input: {
    userId: string;
    requestId: string;
    reason?: "purchase" | "restore" | "app_start" | "retry";
    signal?: AbortSignal;
  }): Promise<AiNovelBillingSyncResult> {
    const context = {
      requestId: input.requestId,
      appId: APP_ID,
      userId: input.userId,
      provider: "revenuecat",
      reason: input.reason ?? "unspecified",
    };
    let snapshot: NormalizedRevenueCatSnapshot;
    try {
      snapshot = await this.fetchSnapshot(input.userId, input.signal);
    } catch (error) {
      const reason = error instanceof RevenueCatApiError ? error.reason : "normalization_failed";
      const membership = await this.getMembership(input.userId);
      this.logger.warn("ainovel billing sync pending", {
        ...context,
        status: "pending",
        failureReason: reason,
        membershipState: membership.state,
      });
      return { syncStatus: "pending", membership };
    }
    if (snapshot.hasActiveUnverifiedEnvironmentEntitlement) {
      const membership = await this.getMembership(input.userId);
      this.logger.warn("ainovel billing sync deferred unverified store environment", {
        ...context,
        status: "pending",
        failureReason: "unverified_store_environment",
        membershipState: membership.state,
      });
      return { syncStatus: "pending", membership };
    }
    await this.persistSnapshot(snapshot);
    const membership = await this.getMembership(input.userId);
    this.logger.info("ainovel billing sync completed", {
      ...context,
      status: "synchronized",
      productKey: membership.planKey ?? undefined,
      membershipState: membership.state,
    });
    return { syncStatus: "synchronized", membership };
  }

  async receiveWebhook(input: {
    request: HttpRequest;
    requestId: string;
    authorization?: string;
  }): Promise<{ status: "processed" | "ignored" | "duplicate" }> {
    this.assertWebhookConfigured();
    if (!constantTimeEqual(input.authorization ?? "", this.webhookAuthorization!)) {
      this.logger.warn("ainovel billing webhook rejected", {
        requestId: input.requestId,
        appId: APP_ID,
        provider: "revenuecat",
        status: "unauthorized",
      });
      throw new ApplicationError(401, "BILLING_WEBHOOK_UNAUTHORIZED", "Webhook authorization failed.");
    }

    const event = readWebhookEvent(input.request.body);
    if (event.appId !== this.revenueCatAppId) {
      throw new ApplicationError(403, "BILLING_WEBHOOK_APP_MISMATCH", "Webhook app ID is not configured for AINovel.");
    }
    const existing = await this.database.findAiNovelBillingWebhookEvent(APP_ID, event.id);
    if (existing) {
      this.logWebhook(input.requestId, event, "duplicate");
      return { status: "duplicate" };
    }

    if (event.environment === "SANDBOX" && !this.allowSandbox) {
      await this.persistWebhookOnly(event, event.appUserId, "ignored");
      this.logWebhook(input.requestId, event, "ignored");
      return { status: "ignored" };
    }

    if (event.type === "TRANSFER") {
      const status = await this.processTransferWebhook(event, input.request.signal);
      this.logWebhook(input.requestId, event, status);
      return { status };
    }

    if (!SUPPORTED_STORES.has(event.store)) {
      await this.persistWebhookOnly(event, event.appUserId, "ignored");
      this.logWebhook(input.requestId, event, "ignored");
      return { status: "ignored" };
    }

    const knownUser = await this.database.findAppUser(APP_ID, event.appUserId);
    if (!knownUser ||
        (knownUser.status !== "ACTIVE" && knownUser.status !== "DELETED")) {
      await this.persistWebhookOnly(event, null, "ignored");
      this.logWebhook(input.requestId, event, "ignored");
      return { status: "ignored" };
    }

    if (!WEBHOOK_HANDLED_EVENTS.has(event.type)) {
      await this.persistWebhookOnly(event, event.appUserId, "ignored");
      this.logWebhook(input.requestId, event, "ignored");
      return { status: "ignored" };
    }

    if (knownUser.status === "DELETED") {
      const status = await this.processDeletedAccountWebhook(
        event,
        knownUser.updatedAt ?? this.now().toISOString(),
      );
      this.logWebhook(input.requestId, event, status);
      return { status };
    }

    let snapshot: NormalizedRevenueCatSnapshot;
    try {
      snapshot = await this.fetchSnapshot(event.appUserId, input.request.signal);
    } catch {
      this.logger.warn("ainovel billing webhook sync pending", {
        requestId: input.requestId,
        appId: APP_ID,
        userId: event.appUserId,
        provider: "revenuecat",
        productKey: event.productId,
        status: "provider_unavailable",
      });
      throw new ApplicationError(503, "BILLING_PROVIDER_UNAVAILABLE", "Membership confirmation is temporarily unavailable.");
    }

    const processedAt = this.now().toISOString();
    const finalStatus = await this.database.withExclusiveSession(async () => {
      const currentUser = await this.database.findAppUser(APP_ID, event.appUserId);
      if (currentUser?.status === "DELETED") {
        return await this.recordDeletedAccountWebhook(
          event,
          currentUser.updatedAt ?? processedAt,
          processedAt,
        );
      }
      if (!currentUser || currentUser.status !== "ACTIVE") {
        const inserted = await this.database.insertAiNovelBillingWebhookEvent(
          toWebhookRecord(event, null, "ignored", processedAt),
        );
        return inserted ? "ignored" : "duplicate";
      }
      const inserted = await this.database.insertAiNovelBillingWebhookEvent(
        toWebhookRecord(event, event.appUserId, "processed", processedAt),
      );
      if (!inserted) return "duplicate";
      await this.writeSnapshot(snapshot);
      // Do not substitute receipt/processing time for a missing provider event
      // timestamp: it could make an old webhook overwrite a newer observation.
      if (event.occurredAt !== null) {
        const webhookTransaction = normalizeRevenueCatWebhookTransaction({
          event: event.transaction,
          userId: event.appUserId,
          observedAt: event.occurredAt,
        });
        if (webhookTransaction) {
          await this.database.upsertAiNovelBillingTransaction(webhookTransaction);
        }
      }
      return "processed";
    });
    this.logWebhook(input.requestId, event, finalStatus, snapshot.membership.planKey);
    return { status: finalStatus };
  }

  private async processDeletedAccountWebhook(
    event: ParsedWebhookEvent,
    accountDeletedAt: string,
  ): Promise<"processed" | "duplicate"> {
    const processedAt = this.now().toISOString();
    return await this.database.withExclusiveSession(async () =>
      await this.recordDeletedAccountWebhook(event, accountDeletedAt, processedAt),
    );
  }

  private async processTransferWebhook(
    event: ParsedWebhookEvent,
    signal?: AbortSignal,
  ): Promise<"processed" | "ignored" | "duplicate"> {
    const affectedUserIds = [...new Set([
      ...event.transferredFrom,
      ...event.transferredTo,
    ])];
    const knownUsers: Array<{
      userId: string;
      status: string;
      deletedAt: string | null;
    }> = [];
    for (const userId of affectedUserIds) {
      const user = await this.database.findAppUser(APP_ID, userId);
      if (user && (user.status === "ACTIVE" || user.status === "DELETED")) {
        knownUsers.push({
          userId,
          status: user.status,
          deletedAt: user.status === "DELETED"
            ? user.updatedAt ?? this.now().toISOString()
            : null,
        });
      }
    }
    if (knownUsers.length === 0) {
      await this.persistWebhookOnly(event, null, "ignored");
      return "ignored";
    }

    const snapshots: NormalizedRevenueCatSnapshot[] = [];
    try {
      for (const user of knownUsers) {
        if (user.status === "ACTIVE") {
          snapshots.push(await this.fetchSnapshot(user.userId, signal));
        }
      }
    } catch (error) {
      this.logger.warn("ainovel billing transfer reconciliation pending", {
        appId: APP_ID,
        userId: event.appUserId,
        provider: "revenuecat",
        eventType: event.type,
        failureReason: error instanceof RevenueCatApiError
          ? error.reason
          : "normalization_failed",
      });
      throw new ApplicationError(
        503,
        "BILLING_PROVIDER_UNAVAILABLE",
        "Membership confirmation is temporarily unavailable.",
      );
    }

    const processedAt = this.now().toISOString();
    return await this.database.withExclusiveSession(async () => {
      const eventUserId = knownUsers.some((user) => user.userId === event.appUserId)
        ? event.appUserId
        : null;
      const inserted = await this.database.insertAiNovelBillingWebhookEvent(
        toWebhookRecord(
          event,
          eventUserId,
          "processed",
          processedAt,
          knownUsers.find((user) => user.deletedAt !== null)?.deletedAt ?? null,
          knownUsers.map((user) => user.userId),
        ),
      );
      if (!inserted) return "duplicate";

      for (const snapshot of snapshots) {
        const currentUser = await this.database.findAppUser(
          APP_ID,
          snapshot.membership.userId,
        );
        if (currentUser?.status === "ACTIVE") {
          await this.writeSnapshot(snapshot);
        }
      }
      return "processed";
    });
  }

  private async recordDeletedAccountWebhook(
    event: ParsedWebhookEvent,
    accountDeletedAt: string,
    processedAt: string,
  ): Promise<"processed" | "duplicate"> {
    const inserted = await this.database.insertAiNovelBillingWebhookEvent(
      toWebhookRecord(event, event.appUserId, "processed", processedAt, accountDeletedAt),
    );
    if (!inserted) return "duplicate";

    // Deleted users must never regain access from store events. Keep only the
    // verified financial order evidence attached to the retained account
    // record, marked with the account deletion timestamp for privacy handling.
    if (event.occurredAt !== null) {
      const transaction = normalizeRevenueCatWebhookTransaction({
        event: event.transaction,
        userId: event.appUserId,
        observedAt: event.occurredAt,
      });
      if (transaction) {
        transaction.accountDeletedAt = accountDeletedAt;
        await this.database.upsertAiNovelBillingTransaction(transaction);
      }
    }
    return "processed";
  }

  private async fetchSnapshot(userId: string, signal?: AbortSignal): Promise<NormalizedRevenueCatSnapshot> {
    const payload = await this.customerApi.getSubscriber(userId, signal);
    return normalizeRevenueCatSnapshot(payload, userId, this.now(), {
      allowSandbox: this.allowSandbox,
    });
  }

  private async persistSnapshot(snapshot: NormalizedRevenueCatSnapshot): Promise<void> {
    await this.database.withExclusiveSession(async () => {
      const user = await this.database.findAppUser(APP_ID, snapshot.membership.userId);
      if (!user || user.status !== "ACTIVE") return;
      await this.writeSnapshot(snapshot);
    });
  }

  private async writeSnapshot(snapshot: NormalizedRevenueCatSnapshot): Promise<void> {
    if (snapshot.hasActiveUnverifiedEnvironmentEntitlement) {
      this.logger.warn("ainovel billing snapshot deferred for unverified store environment", {
        appId: APP_ID,
        userId: snapshot.membership.userId,
        provider: "revenuecat",
        status: "unverified_store_environment",
      });
      return;
    }
    const current = await this.database.findAiNovelBillingMembership(APP_ID, snapshot.membership.userId);
    if (current?.accountDeletedAt) return;
    await this.database.upsertAiNovelBillingMembership(snapshot.membership);
    for (const transaction of snapshot.transactions) {
      await this.database.upsertAiNovelBillingTransaction(transaction);
    }
  }

  private async persistWebhookOnly(
    event: ParsedWebhookEvent,
    userId: string | null,
    status: AiNovelBillingWebhookEventRecord["status"],
  ): Promise<void> {
    const processedAt = this.now().toISOString();
    await this.database.withExclusiveSession(async () => {
      const account = userId
        ? await this.database.findAppUser(APP_ID, userId)
        : undefined;
      await this.database.insertAiNovelBillingWebhookEvent(
        toWebhookRecord(
          event,
          userId,
          status,
          processedAt,
          account?.status === "DELETED"
            ? account.updatedAt ?? processedAt
            : null,
        ),
      );
    });
  }

  private assertWebhookConfigured(): void {
    if (!this.webhookAuthorization || !this.revenueCatAppId) {
      throw new ApplicationError(503, "BILLING_WEBHOOK_NOT_CONFIGURED", "RevenueCat webhook is not configured.");
    }
  }

  private logWebhook(
    requestId: string,
    event: ParsedWebhookEvent,
    status: string,
    productKey?: string | null,
  ): void {
    this.logger.info("ainovel billing webhook received", {
      requestId,
      appId: APP_ID,
      userId: event.appUserId,
      provider: "revenuecat",
      productKey: productKey ?? event.productId ?? undefined,
      status,
      eventType: event.type,
    });
  }
}

interface ParsedWebhookEvent {
  id: string;
  type: string;
  appId: string;
  appUserId: string;
  store: string;
  environment: "SANDBOX" | "PRODUCTION" | null;
  productId: string | null;
  providerTransactionId: string | null;
  occurredAt: string | null;
  transaction: Record<string, unknown>;
  transferredFrom: string[];
  transferredTo: string[];
}

function readWebhookEvent(body: unknown): ParsedWebhookEvent {
  if (!isObject(body) || !boundedString(body.api_version, 64) || !isObject(body.event)) {
    throw new ApplicationError(400, "BILLING_WEBHOOK_INVALID", "RevenueCat webhook event is invalid.");
  }
  const raw = body.event;
  const id = boundedString(raw.id, WEBHOOK_EVENT_ID_MAX_LENGTH);
  const type = boundedString(raw.type, 64);
  const appId = boundedString(raw.app_id, 256);
  const isTransfer = type === "TRANSFER";
  const transferFrom = isTransfer ? boundedStringList(raw.transferred_from) : [];
  const transferTo = isTransfer ? boundedStringList(raw.transferred_to) : [];
  const appUserId = boundedString(raw.app_user_id, 256) ??
    (isTransfer ? transferTo?.[0] : undefined);
  const store = boundedString(raw.store, 64) ?? "";
  const environment = raw.environment;
  if (
    !id || !type || !appId || !appUserId ||
    (!isTransfer && (!store ||
      (environment !== "PRODUCTION" && environment !== "SANDBOX"))) ||
    (isTransfer && (
      transferFrom === undefined ||
      transferTo === undefined ||
      transferFrom.length + transferTo.length > MAX_TRANSFER_USER_IDS
    ))
  ) {
    throw new ApplicationError(400, "BILLING_WEBHOOK_INVALID", "RevenueCat webhook event is invalid.");
  }
  const occurredAt = typeof raw.event_timestamp_ms === "number" && Number.isFinite(raw.event_timestamp_ms)
    ? new Date(raw.event_timestamp_ms).toISOString()
    : null;
  return {
    id,
    type,
    appId,
    appUserId,
    store,
    environment: environment === "SANDBOX" || environment === "PRODUCTION"
      ? environment
      : null,
    productId: boundedString(raw.product_id, 128) || null,
    providerTransactionId: boundedString(raw.transaction_id, 256) || null,
    occurredAt,
    transferredFrom: transferFrom ?? [],
    transferredTo: transferTo ?? [],
    transaction: {
      type,
      product_id: raw.product_id,
      transaction_id: raw.transaction_id,
      store,
      environment,
      purchased_at_ms: raw.purchased_at_ms,
      original_purchased_at_ms: raw.original_purchased_at_ms,
      expiration_at_ms: raw.expiration_at_ms,
      cancel_reason: raw.cancel_reason,
      price_in_purchased_currency: raw.price_in_purchased_currency,
      currency: raw.currency,
      period_type: raw.period_type,
    },
  };
}

function boundedStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  if (value.length > MAX_TRANSFER_USER_IDS) return undefined;
  const values = value.map((item) => boundedString(item, 256));
  if (values.some((item) => item === undefined)) return undefined;
  return values as string[];
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength
    ? value.trim()
    : undefined;
}

function toWebhookRecord(
  event: ParsedWebhookEvent,
  userId: string | null,
  status: AiNovelBillingWebhookEventRecord["status"],
  processedAt: string,
  accountDeletedAt: string | null = null,
  affectedUserIds: string[] = [],
): AiNovelBillingWebhookEventRecord {
  return {
    appId: APP_ID,
    eventId: event.id,
    eventType: event.type,
    userId,
    affectedUserIds,
    productId: event.productId,
    providerTransactionId: event.providerTransactionId,
    status,
    occurredAt: event.occurredAt,
    processedAt,
    accountDeletedAt,
  };
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function toMembershipInfo(
  record: AiNovelBillingMembershipRecord,
  now: Date,
): AiNovelBillingMembershipInfo {
  const expired = record.active && record.expiresAt !== null &&
    Date.parse(record.expiresAt) <= now.getTime();
  return {
    active: record.active && !expired,
    state: expired ? "expired" : record.state,
    tier: record.tier,
    planKey: record.planKey,
    expiresAt: record.expiresAt,
    autoRenew: record.autoRenew,
    source: record.source,
    managementUrl: record.managementUrl,
  };
}
