import { ALIPAY_ORDER_ID_PATTERN, createAlipayOrderId } from "../modules/billing/alipay-order-id.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import type { AiNovelBillingMembershipInfo } from "../shared/types.ts";
import type { AlipayCreateInput, AlipayOptions, AlipayOrder } from "../modules/billing/alipay-models.ts";
import { ALIPAY_PRICES, alipayConfigured, assertAlipayChannel, membershipConflict, publicAlipayOrder } from "../modules/billing/alipay-policy.ts";
import { parseAlipayNotify } from "../modules/billing/alipay-notify.ts";
import { OfficialAlipayGateway } from "./ainovel-alipay-gateway.ts";
import { confirmAlipayOrder } from "./ainovel-alipay-confirmation.ts";
import { alipayTransaction } from "./ainovel-alipay-projection.ts";
import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";

export class AiNovelAlipayService {
  private readonly gateway;
  private readonly now;
  constructor(private readonly database: ApplicationDatabase, private readonly options: AlipayOptions,
    private readonly getMembership: (user: string) => Promise<AiNovelBillingMembershipInfo>, private readonly logger: StructuredLogger) {
    this.gateway = options.gateway ?? new OfficialAlipayGateway(options);
    this.now = options.now ?? (() => new Date());
  }
  get available() { return alipayConfigured(this.options); }
  price(product: AlipayCreateInput["productKey"]) { return this.options.prices?.[product] ?? ALIPAY_PRICES[product]; }
  private configured() { if (!this.available) throw new ApplicationError(503, "BILLING_PROVIDER_UNAVAILABLE", "Alipay is not enabled and fully configured."); }
  async create(userId: string, region: string, input: AlipayCreateInput, requestId?: string) {
    const log = (status: string, order?: AlipayOrder) => this.log(status, order, userId, undefined, requestId);
    log("create_start");
    this.configured(); assertAlipayChannel(region, input.platform, input.distribution);
    const now = this.now();
    const order = await this.database.withExclusiveSession(async () => {
      const account = await this.database.findAppUser("ai_novel", userId);
      if (!account || account.status === "DELETED") throw new ApplicationError(403, "BILLING_ACCOUNT_UNAVAILABLE", "Account is unavailable.");
      const existing = await this.database.findAiNovelAlipayIdempotency(userId, input.idempotencyKey);
      if (existing) {
        log("create_replay", existing);
        if (existing.productKey !== input.productKey || existing.platform !== input.platform || existing.distribution !== input.distribution ||
          existing.merchantAppId !== this.options.appId || existing.sellerId !== (this.options.sellerId?.trim() || "") || existing.environment !== this.options.environment)
          throw new ApplicationError(409, "BILLING_IDEMPOTENCY_CONFLICT", "Idempotency key belongs to different order inputs.");
        return existing;
      }
      if (membershipConflict(await this.database.findAiNovelBillingMembership("ai_novel", userId), input.productKey, now))
        throw new ApplicationError(409, "BILLING_PROVIDER_CONFLICT", "An active store membership prevents Alipay checkout.");
      const amountMinor = this.price(input.productKey);
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new ApplicationError(503, "BILLING_PROVIDER_UNAVAILABLE", "Alipay price is not configured.");
      const created: AlipayOrder = { ...input, orderId: createAlipayOrderId(input.platform, input.productKey, userId), appId: "ai_novel", userId,
        provider: "alipay", merchantAppId: this.options.appId!, sellerId: this.options.sellerId?.trim() || "", environment: this.options.environment!,
        status: "pending", amountMinor, currency: "CNY", createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
        paidAt: null, providerTransactionId: null, membershipApplied: false, membershipExpiresAt: null, conflict: null, accountDeletedAt: null };
      await this.database.saveAiNovelAlipayOrder(created);
      await this.database.upsertAiNovelBillingTransaction(alipayTransaction(created, now.toISOString()));
      log("order_persisted", created);
      return created;
    });
    if (order.status !== "pending" || order.expiresAt <= now.toISOString()) return { order: publicAlipayOrder(order), payment: null };
    try { const payment = await this.gateway.payment(order); log("checkout_prepared", order); return { order: publicAlipayOrder(order), payment }; }
    catch {
      log("signing_failed", order);
      await this.database.withExclusiveSession(async () => {
        const current = await this.database.findAiNovelAlipayOrder(order.orderId);
        if (current?.status === "pending") { current.status = "failed"; await this.database.saveAiNovelAlipayOrder(current);
          await this.database.upsertAiNovelBillingTransaction(alipayTransaction(current, this.now().toISOString())); }
      });
      throw new ApplicationError(503, "BILLING_PROVIDER_UNAVAILABLE", "Alipay checkout could not be prepared.");
    }
  }
  async query(userId: string, orderId: string, requestId?: string) {
    const log = (status: string, order?: AlipayOrder) => this.log(status, order, userId, orderId, requestId);
    log("query_start");
    let order = await this.ownedOrder(userId, orderId);
    let syncStatus: "synchronized" | "pending" = order.status === "paid" ? (order.membershipApplied && !order.conflict ? "synchronized" : "pending") : order.status === "closed" || order.status === "failed" ? "synchronized" : "pending";
    if (order.status === "pending" && this.available && this.sameMerchant(order)) {
      try {
        const evidence = await this.gateway.query(orderId);
        if (evidence.code === "10000") {
          if (evidence.out_trade_no !== orderId) throw new Error("Order mismatch");
          order = await confirmAlipayOrder(this.database, this.options, evidence, "query", this.now());
          syncStatus = order.status === "paid" ? (order.membershipApplied && !order.conflict ? "synchronized" : "pending") : order.status === "closed" ? "synchronized" : "pending";
          log("query_settled", order);
        }
        else if (evidence.code === "40004" && evidence.sub_code === "ACQ.TRADE_NOT_EXIST" && order.expiresAt <= this.now().toISOString()) {
          order = await this.database.withExclusiveSession(async () => {
            const current = (await this.ownedOrder(userId, orderId));
            if (current.status === "pending") {
              current.status = "closed";
              await this.database.saveAiNovelAlipayOrder(current);
              await this.database.upsertAiNovelBillingTransaction(alipayTransaction(current, this.now().toISOString()));
            }
            return current;
          });
          syncStatus = order.status === "closed" ? "synchronized" : "pending";
          log("query_expired_not_found", order);
        } else log("query_provider_pending", order);
      } catch (error) { log(error instanceof ApplicationError && error.code === "BILLING_QUERY_SIGNATURE_INVALID" ? "query_signature_rejected" : error instanceof ApplicationError && error.code === "BILLING_EVIDENCE_MISMATCH" ? "query_evidence_rejected" : "query_unavailable", order); }
    }
    log("query_result", order);
    return { order: publicAlipayOrder(order), syncStatus, membership: await this.getMembership(userId) };
  }
  private sameMerchant(order: AlipayOrder) { return order.merchantAppId === this.options.appId && order.sellerId === (this.options.sellerId?.trim() || "") && order.environment === this.options.environment; }
  private async ownedOrder(user: string, id: string) {
    const order = ALIPAY_ORDER_ID_PATTERN.test(id) ? await this.database.findAiNovelAlipayOrder(id) : undefined;
    if (!order || order.userId !== user) throw new ApplicationError(404, "BILLING_ORDER_NOT_FOUND", "Alipay order not found.");
    return order;
  }
  async notify(body: unknown, requestId?: string) {
    const log = (status: string, order?: AlipayOrder) => this.log(status, order, undefined, undefined, requestId);
    this.configured();
    let fields: Record<string, string>;
    try { fields = parseAlipayNotify(body); }
    catch (error) { log("notify_form_rejected"); throw error; }
    let verified = false;
    try { verified = await this.gateway.verifyNotify(fields); } catch { /* SDK/key errors are deliberately not exposed or logged. */ }
    if (!verified) { log("notify_signature_rejected"); throw new ApplicationError(401, "BILLING_NOTIFY_UNAUTHORIZED", "Alipay signature verification failed."); }
    log("notify_verified");
    let order: AlipayOrder;
    try { order = await this.database.withExclusiveSession(async () => {
      const settled = await confirmAlipayOrder(this.database, this.options, fields, "notify", this.now());
      const account = await this.database.findAppUser("ai_novel", settled.userId);
      const persisted = await this.database.findAiNovelAlipayOrder(settled.orderId);
      const deletedAt = persisted?.accountDeletedAt ?? (account?.status === "DELETED" ? account.updatedAt ?? this.now().toISOString() : null);
      await this.database.insertAiNovelBillingWebhookEvent({ appId: "ai_novel", eventId: `alipay:${fields.notify_id || `${settled.orderId}:${fields.trade_status}`}`,
        eventType: `ALIPAY_${fields.trade_status}`, userId: settled.userId, affectedUserIds: [settled.userId], productId: settled.productKey,
        providerTransactionId: settled.orderId, status: "processed", occurredAt: settled.paidAt, processedAt: this.now().toISOString(), accountDeletedAt: deletedAt });
      return settled;
    }); }
    catch (error) { log("notify_settlement_rejected"); throw error; }
    log("notify_settled", order);
    return "success";
  }
  private log(status: string, order?: AlipayOrder, userId?: string, orderId?: string, requestId?: string) {
    this.logger.info("ainovel alipay billing", { appId: "ai_novel", provider: "alipay", status,
      userId: order?.userId ?? userId, orderId: order?.orderId ?? orderId,
      requestId,
      paymentStatus: order?.status, membershipApplied: order?.membershipApplied, conflict: order?.conflict });
  }
}
