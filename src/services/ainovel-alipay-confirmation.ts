import { inBillingEnvironment } from "../modules/billing/billing-environment.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import type { AlipayOptions, AlipayOrder } from "../modules/billing/alipay-models.ts";
import { alipayPaidAt, parseAlipayMoney } from "../modules/billing/alipay-policy.ts";
import { readAlipayFullRefund, type AlipayFullRefund } from "../modules/billing/alipay-refund.ts";
import { alipaySettlementTransaction } from "./ainovel-alipay-projection.ts";
import { rebuildAlipayEntitlements } from "./ainovel-alipay-entitlements.ts";

type Settlement = { order: AlipayOrder; refund?: AlipayFullRefund };

/** Both verified SDK queries and verified notifications enter this same atomic settlement. */
export async function confirmAlipayOrder(database: ApplicationDatabase, options: AlipayOptions,
  evidence: Record<string, unknown>, origin: "query" | "notify", now: Date): Promise<AlipayOrder> {
  const result = await database.withExclusiveSession(() => settleOrder(database, options, evidence, origin, now));
  return result.order;
}

export async function settleAlipayNotification(database: ApplicationDatabase, options: AlipayOptions,
  fields: Record<string, string>, clock: () => Date): Promise<AlipayOrder> {
  return database.withExclusiveSession(async () => {
    const now = clock();
    const { order, refund } = await settleOrder(database, options, fields, "notify", now);
    const account = await database.findAppUser("ai_novel", order.userId);
    const deletedAt = order.accountDeletedAt ?? (account?.status === "DELETED" ? account.updatedAt ?? now.toISOString() : null);
    const event = refund ? "FULL_REFUND" : fields.trade_status;
    await database.insertAiNovelBillingWebhookEvent({
      appId: "ai_novel", eventId: `alipay:${fields.notify_id || `${order.orderId}:${event}`}`,
      eventType: `ALIPAY_${event}`, userId: order.userId, affectedUserIds: [order.userId], productId: order.productKey,
      providerTransactionId: order.orderId, status: "processed", occurredAt: refund?.refundedAt ?? order.paidAt,
      processedAt: now.toISOString(), accountDeletedAt: deletedAt,
    });
    return order;
  });
}

async function settleOrder(database: ApplicationDatabase, options: AlipayOptions,
  evidence: Record<string, unknown>, origin: "query" | "notify", now: Date): Promise<Settlement> {
  const id = evidence.out_trade_no;
  if (typeof id !== "string") reject();
  const order = await database.findAiNovelAlipayOrder(id);
  if (!order) throw new ApplicationError(404, "BILLING_ORDER_NOT_FOUND", "Alipay order not found.");
  if (order.merchantAppId !== options.appId || order.sellerId !== (options.sellerId?.trim() || "") || order.environment !== options.environment ||
    (origin === "notify" && (evidence.app_id !== order.merchantAppId || typeof evidence.seller_id !== "string" || !evidence.seller_id.trim())) ||
    (evidence.app_id !== undefined && evidence.app_id !== order.merchantAppId) ||
    (order.sellerId && evidence.seller_id !== undefined && evidence.seller_id !== order.sellerId) ||
    parseAlipayMoney(evidence.total_amount) !== order.amountMinor) reject();
  const status = evidence.trade_status;
  if (!["TRADE_SUCCESS", "TRADE_FINISHED", "TRADE_CLOSED", "WAIT_BUYER_PAY"].includes(String(status))) reject();
  const trade = evidence.trade_no;
  if (typeof trade !== "string" || !/^\d{10,64}$/.test(trade)) reject();
  if (order.providerTransactionId && order.providerTransactionId !== trade) reject();

  const earliestPayment = new Date(Date.parse(order.createdAt) - 300_000).toISOString();
  const refund = origin === "notify" ? readAlipayFullRefund(evidence, order.amountMinor, order.paidAt ?? earliestPayment, now) : undefined;
  const paymentTime = evidence.gmt_payment ?? evidence.send_pay_date;
  if (refund) {
    const paidAt = order.paidAt ?? (paymentTime ? requirePaymentTime(paymentTime, earliestPayment, now) : null);
    if (paidAt && paidAt > refund.refundedAt) reject();
    const candidate: AlipayOrder = { ...order, providerTransactionId: trade, status: paidAt ? "paid" : "closed", paidAt };
    return { order: await commitAlipayOrder(database, candidate, now, refund), refund };
  }

  // Old WAIT/CLOSED events cannot undo a successful payment.
  if (order.status === "paid") return { order: await commitAlipayOrder(database, order, now) };
  const candidate = { ...order, providerTransactionId: trade };
  if (status === "WAIT_BUYER_PAY") {
    await database.saveAiNovelAlipayOrder(candidate);
    return { order: candidate };
  }
  if (status === "TRADE_CLOSED") candidate.status = "closed";
  else {
    candidate.status = "paid";
    candidate.paidAt = requirePaymentTime(paymentTime, earliestPayment, now);
  }
  return { order: await commitAlipayOrder(database, candidate, now) };
}

/** The only local settlement path for verified notifications, query results and paid recovery. */
export async function commitAlipayOrder(database: ApplicationDatabase, order: AlipayOrder, now: Date,
  refund?: AlipayFullRefund): Promise<AlipayOrder> {
  return database.withExclusiveSession(() => inBillingEnvironment(order.environment, async () => {
    // Never trust a candidate copied before a simultaneous notification committed.
    const latest = await database.findAiNovelAlipayOrder(order.orderId);
    if (latest?.status === "paid" && order.status !== "paid") order = latest;
    const transactions = await database.listAiNovelBillingTransactions("ai_novel", order.userId);
    const existing = transactions.find(record => record.provider === "alipay" && record.providerTransactionId === order.orderId &&
      record.isSandbox === (order.environment === "sandbox"));
    if (existing?.refundedAt && order.paidAt && order.paidAt > existing.refundedAt) reject();
    const transaction = alipaySettlementTransaction(order, now.toISOString(), existing, refund);
    await database.saveAiNovelAlipayOrder(order);
    if (transaction) await database.upsertAiNovelBillingTransaction(transaction);
    if (order.status === "paid" || refund) await rebuildAlipayEntitlements(database, order.userId, now);
    return (await database.findAiNovelAlipayOrder(order.orderId))!;
  }));
}

function requirePaymentTime(value: unknown, earliest: string, now: Date): string {
  const paidAt = alipayPaidAt(value);
  if (!paidAt || paidAt < earliest || Date.parse(paidAt) > now.getTime() + 300_000) reject();
  return paidAt;
}

function reject(): never { throw new ApplicationError(400, "BILLING_EVIDENCE_MISMATCH", "Alipay settlement evidence is invalid."); }
