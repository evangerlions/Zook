import { providerQuery } from "../modules/billing/provider-query.ts";
import type { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import type { AlipayOptions, AlipayOrder } from "../modules/billing/alipay-models.ts";
import { billingEnvironment } from "../modules/billing/billing-environment.ts";
import type { MembershipSyncInput, MembershipSyncResult, TargetPurchase } from "../modules/billing/membership-sync.ts";
import { ApplicationError } from "../shared/errors.ts";
import { userAlipayOrders } from "./ainovel-alipay-entitlements.ts";
import { commitAlipayOrder, confirmAlipayOrder } from "./ainovel-alipay-confirmation.ts";
import type { AiNovelBillingMembershipInfo } from "../shared/types.ts";

interface Dependencies {
  database: ApplicationDatabase;
  options: AlipayOptions;
  logger: StructuredLogger;
  query: (id: string, signal?: AbortSignal) => Promise<Record<string, unknown>>;
  getMembership: (user: string) => Promise<AiNovelBillingMembershipInfo>;
  now: () => Date;
  available: boolean;
}
export async function syncAlipayMembership(input: MembershipSyncInput, d: Dependencies, candidates?: string[]): Promise<MembershipSyncResult> {
  const startedAt = d.now().toISOString();
  const ids = new Set<string>();
  const transactions = await d.database.listAiNovelBillingTransactions("ai_novel", input.userId);
  const revoked = new Set(transactions.filter(record => record.provider === "alipay" &&
    record.isSandbox === (billingEnvironment() === "sandbox") &&
    (record.status === "refunded" || record.status === "revoked")).map(record => record.providerTransactionId));
  const reference = input.purchaseReference;
  if (reference) {
    const target = await d.database.findAiNovelAlipayOrder(reference.id);
    if (!target || target.userId !== input.userId || target.environment !== billingEnvironment())
      throw new ApplicationError(404, "BILLING_ORDER_NOT_FOUND", "Alipay order not found.");
    ids.add(target.orderId);
  }
  if (candidates) for (const id of candidates) ids.add(id);
  else for await (const order of userAlipayOrders(d.database, input.userId, startedAt)) {
    if (needsConfirmation(order, revoked) || (revoked.has(order.orderId) && order.membershipApplied)) ids.add(order.orderId);
  }
  d.logger.info("membership sync started", { requestId: input.requestId, userId: input.userId, provider: "alipay", environment: billingEnvironment(), candidateCount: ids.size });
  for (const id of ids) {
    input.signal?.throwIfAborted();
    const order = await d.database.findAiNovelAlipayOrder(id);
    if (!order || order.userId !== input.userId || order.environment !== billingEnvironment()) continue;
    if (candidates) await d.database.withExclusiveSession(async () => {
      const latest = await d.database.findAiNovelAlipayOrder(id);
      if (latest) await d.database.saveAiNovelAlipayOrder({ ...latest, lastRecoveryAt: d.now().toISOString() });
    });
    if (order.status === "paid") {
      // Trusted local refund facts converge even without another provider notification.
      if ((!order.membershipApplied && !order.accountDeletedAt && !revoked.has(id)) ||
          (order.membershipApplied && revoked.has(id))) await commitAlipayOrder(d.database, order, d.now());
      continue;
    }
    if (order.status !== "pending" || !d.available || !sameMerchant(order, d.options)) continue;
    const queryStarted = performance.now();
    let evidence: Record<string, unknown>;
    try {
      evidence = await providerQuery(signal => d.query(id, signal), input.signal, d.options.queryTimeoutMs);
      input.signal?.throwIfAborted();
      if (evidence.code === "10000" && evidence.out_trade_no !== id) throw new Error("Unexpected order evidence");
      if (evidence.code !== "10000") {
        // A verified not-found response plus local checkout expiry permits closing.
        if (evidence.code === "40004" && evidence.sub_code === "ACQ.TRADE_NOT_EXIST" && order.expiresAt <= d.now().toISOString()) {
          await d.database.withExclusiveSession(async () => {
            const current = await d.database.findAiNovelAlipayOrder(id);
            if (current?.status === "pending") await commitAlipayOrder(d.database, { ...current, status: "closed" }, d.now());
          });
        }
        continue;
      }
    } catch {
      input.signal?.throwIfAborted();
      d.logger.warn("membership order query pending", { requestId: input.requestId, orderId: id, durationMs: Math.round(performance.now() - queryStarted) });
      continue;
    }
    // Evidence rejection is pending; database errors must propagate, not masquerade as a timeout.
    try { await confirmAlipayOrder(d.database, d.options, evidence, "query", d.now()); }
    catch (error) {
      if (!(error instanceof ApplicationError) || error.code !== "BILLING_EVIDENCE_MISMATCH") throw error;
      d.logger.warn("membership order evidence rejected", { orderId: id, requestId: input.requestId });
    }
  }
  let pendingOrderCount = 0;
  for await (const order of userAlipayOrders(d.database, input.userId, startedAt)) {
    if (needsConfirmation(order, revoked)) pendingOrderCount++;
  }
  const target = reference ? await d.database.findAiNovelAlipayOrder(reference.id) : undefined;
  const targetPurchase: TargetPurchase | null = target && reference ? {
    reference, status: target.status,
    entitlementStatus: target.status === "paid" ? revoked.has(target.orderId) ? "blocked" : target.membershipApplied ? "applied" : target.conflict || target.accountDeletedAt ? "blocked" : "pending"
      : target.status === "pending" ? "pending" : "not_applicable",
  } : null;
  const result: MembershipSyncResult = { syncStatus: pendingOrderCount ? "pending" : "complete", targetPurchase,
    pendingOrderCount, membership: await d.getMembership(input.userId), checkedAt: d.now().toISOString() };
  d.logger.info("membership sync completed", { requestId: input.requestId, userId: input.userId, provider: "alipay", syncStatus: result.syncStatus, pendingOrderCount });
  return result;
}
function sameMerchant(order: AlipayOrder, options: AlipayOptions) {
  return order.environment === options.environment && order.merchantAppId === options.appId && order.sellerId === (options.sellerId?.trim() || "");
}

function needsConfirmation(order: AlipayOrder, revoked: Set<string>) {
  return order.status === "pending" || (order.status === "paid" && !order.membershipApplied &&
    !order.accountDeletedAt && !revoked.has(order.orderId));
}
