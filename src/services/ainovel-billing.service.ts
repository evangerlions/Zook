import { readWebhookEvent, toWebhookRecord, type ParsedWebhookEvent } from "../modules/billing/revenuecat-webhook-event.ts";
import { billingEnvironment, billingDeploymentEnvironment, billingSandboxAllowed, inBillingEnvironment } from "../modules/billing/billing-environment.ts";
import { timingSafeEqual } from "node:crypto";
import { AiNovelAlipayEnvironments } from "./ainovel-alipay-environments.ts";
import { readAlipayMembership } from "./ainovel-alipay-projection.ts";
import { anchorMembershipCredits } from "../modules/billing/billing-credit-window.ts";
import { selectStoreMembership, storeSnapshotConflicts } from "../modules/billing/billing-channel-policy.ts";
import type { AlipayEnvironmentOptions } from "../modules/billing/alipay-models.ts";
import type { AlipayPrices } from "../modules/billing/ainovel-alipay-pricing.ts";
import { syncMembership } from "./ainovel-billing-sync.ts";
import { syncRevenueCatMembership } from "./ainovel-revenuecat-membership-sync.ts";
import { syncAppleReviewMembership } from "./ainovel-apple-review-sync.ts";
import { persistRevenueCatSnapshot } from "./ainovel-revenuecat-snapshot-persistence.ts";
import type { MembershipSyncInput, MembershipSyncResult } from "../modules/billing/membership-sync.ts";
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
import { buildEmptyMembershipInfo, billingMembershipInfo } from "../modules/billing/billing-membership.ts";
import { AppleSandboxAccess, appleSandboxPayload } from "../modules/billing/apple-sandbox-access.ts";
import {
  normalizeRevenueCatSnapshot,
  type NormalizedRevenueCatSnapshot,
} from "../modules/billing/ainovel-revenuecat-normalizer.ts";
import { normalizeRevenueCatWebhookTransaction } from "../modules/billing/ainovel-revenuecat-webhook.ts";
import {
  RevenueCatApiError,
  RevenueCatCustomerApi,
} from "./ainovel-revenuecat-client.ts";

const APP_ID = "ai_novel" as const;
const SUPPORTED_STORES = new Set(["APP_STORE", "MAC_APP_STORE", "PLAY_STORE"]);
const REVENUECAT_SYNC_TIMEOUT_MS = 20_000;
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
  alipay?: AlipayEnvironmentOptions;
  readAlipayPrices?: () => Promise<AlipayPrices | undefined>;
  readAppleSandboxUserIds?: () => Promise<readonly string[]>;
  secretApiKey?: string;
  revenueCatProjectId?: string;
  webhookAuthorization?: string;
  revenueCatAppId?: string;
  revenueCatGoogleAppId?: string;
  appEnvironment?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
}

export class AiNovelBillingService {
  readonly alipay: AiNovelAlipayEnvironments;
  readonly appleSandbox: AppleSandboxAccess;
  private readonly customerApi: RevenueCatCustomerApi;
  private readonly now: () => Date;

  constructor(
    private readonly database: ApplicationDatabase,
    options: AiNovelBillingServiceOptions,
    private readonly logger: StructuredLogger,
  ) {
    this.customerApi = new RevenueCatCustomerApi({
      secretApiKey: options.secretApiKey,
      projectId: options.revenueCatProjectId,
      appId: options.revenueCatAppId,
      googleAppId: options.revenueCatGoogleAppId,
      fetcher: options.fetcher,
      timeoutMs: options.timeoutMs ?? REVENUECAT_SYNC_TIMEOUT_MS,
      logger,
      now: options.now,
    });
    this.webhookAuthorization = options.webhookAuthorization?.trim();
    this.revenueCatAppId = options.revenueCatAppId?.trim();
    this.revenueCatGoogleAppId = options.revenueCatGoogleAppId?.trim();
    const deployment = options.appEnvironment ?? billingDeploymentEnvironment();
    this.allowSandbox = billingSandboxAllowed(deployment);
    this.now = options.now ?? (() => new Date());
    this.appleSandbox = new AppleSandboxAccess(database, deployment, options.readAppleSandboxUserIds ?? (async () => []), this.now);
    this.alipay = new AiNovelAlipayEnvironments(database, options.alipay ?? {}, deployment, user => this.getMembership(user), logger,
      options.readAlipayPrices ?? (async () => undefined));
  }

  private readonly webhookAuthorization: string | undefined;
  private readonly revenueCatAppId: string | undefined;
  private readonly revenueCatGoogleAppId: string | undefined;
  private readonly allowSandbox: boolean;

  async getMembership(userId: string): Promise<AiNovelBillingMembershipInfo> {
    const record = await this.getMembershipRecord(userId);
    if (!record || record.accountDeletedAt) return buildEmptyMembershipInfo();
    return billingMembershipInfo(record, this.now());
  }

  /** Internal consistent entitlement snapshot, including billing-owned credit anchor. */
  async getMembershipRecord(userId: string): Promise<AiNovelBillingMembershipRecord | undefined> {
    return readAlipayMembership(this.database, userId, this.now());
  }

  async syncMembership(input: MembershipSyncInput): Promise<MembershipSyncResult> {
    return syncMembership(input, {
      alipay: () => this.alipay.syncAlipayMembership(input),
      revenuecat: async () => {
        const dependencies = {
          logger: this.logger,
          fetchSnapshot: () => this.fetchSnapshot(input.userId, input.signal, input.requestId),
          persistSnapshot: (snapshot: NormalizedRevenueCatSnapshot, transactionId?: string) => persistRevenueCatSnapshot(this.database, snapshot,
            () => this.writeSnapshot(snapshot), transactionId),
          getMembership: () => this.getMembership(input.userId),
          now: this.now,
        };
        return !this.allowSandbox && billingEnvironment() === "sandbox" && await this.appleSandbox.allows(input.userId)
          ? syncAppleReviewMembership(input, dependencies, () => this.customerApi.getSnapshot(input.userId, input.signal, input.requestId), this.now)
          : syncRevenueCatMembership(input, dependencies);
      },
    });
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
    return inBillingEnvironment(event.environment === "SANDBOX" ? "sandbox" : "production", () => this.receiveScopedWebhook(input, event));
  }

  private async receiveScopedWebhook(input: { request: HttpRequest; requestId: string }, event: ParsedWebhookEvent): Promise<{ status: "processed" | "ignored" | "duplicate" }> {
    this.logWebhook(input.requestId, event, "processing");
    const configuredApps = [this.revenueCatAppId, this.revenueCatGoogleAppId].filter(Boolean);
    const expectedAppId = event.store === "PLAY_STORE" ? this.revenueCatGoogleAppId : this.revenueCatAppId;
    if (!configuredApps.includes(event.appId) || (SUPPORTED_STORES.has(event.store) && event.appId !== expectedAppId)) {
      this.logWebhook(input.requestId, event, "app_mismatch");
      throw new ApplicationError(403, "BILLING_WEBHOOK_APP_MISMATCH", "Webhook app ID is not configured for AINovel.");
    }
    const existing = await this.database.findAiNovelBillingWebhookEvent(APP_ID, event.id);
    if (existing) {
      this.logWebhook(input.requestId, event, "duplicate");
      return { status: "duplicate" };
    }

    if (event.environment === "SANDBOX" && !this.allowSandbox && !await this.appleSandbox.allowsEvent(event)) {
      await this.persistWebhookOnly(event, event.appUserId, "ignored");
      this.logWebhook(input.requestId, event, "ignored");
      return { status: "ignored" };
    }

    if (event.type === "TRANSFER") {
      const status = await this.processTransferWebhook(event, input.request.signal, input.requestId);
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
      snapshot = await this.fetchSnapshot(event.appUserId, input.request.signal, input.requestId);
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
      await this.writeSnapshot(snapshot);
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
    requestId?: string,
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
          const allowSandbox = this.allowSandbox || (await this.appleSandbox.allowsEvent(event) && await this.appleSandbox.allows(user.userId));
          const environments = event.environment === null && allowSandbox
            ? ["production", "sandbox"] as const : [billingEnvironment()];
          const payload = await this.customerApi.getSnapshot(user.userId, signal, requestId);
          for (const environment of environments) {
            if (environment === "sandbox" && !allowSandbox) continue;
            snapshots.push(inBillingEnvironment(environment, () => normalizeRevenueCatSnapshot(
              environment === "sandbox" && !this.allowSandbox ? appleSandboxPayload(payload) : payload,
              user.userId, this.now(), { allowSandbox })));
          }
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
          await this.writeSnapshot(snapshot, event.transferredFrom.includes(snapshot.membership.userId));
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

  private async fetchSnapshot(userId: string, signal?: AbortSignal, requestId?: string): Promise<NormalizedRevenueCatSnapshot> {
    const payload = await this.customerApi.getSnapshot(userId, signal, requestId);
    const appleSandbox = !this.allowSandbox && billingEnvironment() === "sandbox" && await this.appleSandbox.allows(userId);
    return normalizeRevenueCatSnapshot(appleSandbox ? appleSandboxPayload(payload) : payload,
      userId, this.now(), { allowSandbox: this.allowSandbox || appleSandbox });
  }

  private async writeSnapshot(snapshot: NormalizedRevenueCatSnapshot, transferredAway = false): Promise<void> {
    return inBillingEnvironment(snapshot.membership.environment ?? billingEnvironment(),
      () => this.writeScopedSnapshot(snapshot, transferredAway));
  }
  private async writeScopedSnapshot(snapshot: NormalizedRevenueCatSnapshot, transferredAway: boolean): Promise<void> {
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
    const effective = current?.source === "alipay" ? await readAlipayMembership(this.database, snapshot.membership.userId, this.now()) : current;
    const selected = selectStoreMembership(snapshot, effective, this.now(), transferredAway);
    if (storeSnapshotConflicts(snapshot, selected)) this.logger.warn("ainovel billing cross-channel payment conflict", {
      appId: APP_ID, userId: snapshot.membership.userId, provider: "revenuecat",
      status: "provider_conflict", activeSource: selected.source, incomingSource: snapshot.membership.source,
    });
    for (const transaction of snapshot.transactions) {
      await this.database.upsertAiNovelBillingTransaction(transaction);
    }
    if (selected !== effective) await this.database.upsertAiNovelBillingMembership(
      anchorMembershipCredits(effective, selected, (await this.database.listAiNovelBillingTransactions(APP_ID, snapshot.membership.userId)).filter(t => t.isSandbox === (billingEnvironment() === "sandbox"))));
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
    if (!this.webhookAuthorization || (!this.revenueCatAppId && !this.revenueCatGoogleAppId)) {
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
      providerEventId: event.id,
      providerTransactionId: event.providerTransactionId,
      environment: event.environment,
    });
  }
}


function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
