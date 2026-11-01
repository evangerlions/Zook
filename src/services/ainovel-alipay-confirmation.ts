import { inBillingEnvironment } from "../modules/billing/billing-environment.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import type { AlipayOptions, AlipayOrder } from "../modules/billing/alipay-models.ts";
import { alipayPaidAt, parseAlipayMoney } from "../modules/billing/alipay-policy.ts";
import { alipayTransaction } from "./ainovel-alipay-projection.ts";
import { rebuildAlipayEntitlements } from "./ainovel-alipay-entitlements.ts";

/** Both verified SDK queries and verified notifications enter this same atomic settlement. */
export async function confirmAlipayOrder(database: ApplicationDatabase, options: AlipayOptions,
  evidence: Record<string, unknown>, origin: "query" | "notify", now: Date): Promise<AlipayOrder> {
  return database.withExclusiveSession(async () => {
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
    // Successful payment is monotonic. Old WAIT/CLOSED notices cannot undo financial evidence.
    if (order.status === "paid") return commitAlipayOrder(database, order, now);
    order.providerTransactionId = trade;
    if (status === "WAIT_BUYER_PAY") {
      await database.saveAiNovelAlipayOrder(order);
      return order;
    }
    if (status === "TRADE_CLOSED") order.status = "closed";
    else {
      const paidAt = alipayPaidAt(evidence.gmt_payment ?? evidence.send_pay_date);
      if (!paidAt || Date.parse(paidAt) > now.getTime() + 300_000 || Date.parse(paidAt) < Date.parse(order.createdAt) - 300_000) reject();
      order.status = "paid";
      order.paidAt = paidAt;
    }
    return commitAlipayOrder(database, order, now);
  });
}

/** The only local settlement path for verified notifications, query results and paid recovery. */
export async function commitAlipayOrder(database: ApplicationDatabase, order: AlipayOrder, now: Date): Promise<AlipayOrder> {
  return database.withExclusiveSession(() => inBillingEnvironment(order.environment, async () => {
    // Never trust a candidate copied before a simultaneous notification committed.
    const latest = await database.findAiNovelAlipayOrder(order.orderId);
    if (latest?.status === "paid" && order.status !== "paid") order = latest;
    await database.saveAiNovelAlipayOrder(order);
    // A repeated paid notice cannot supersede a trusted refund/revocation fact.
    const transactions = await database.listAiNovelBillingTransactions("ai_novel", order.userId);
    const revoked = transactions.some(record => record.providerTransactionId === order.orderId &&
      record.isSandbox === (order.environment === "sandbox") &&
      (record.status === "refunded" || record.status === "revoked"));
    if (!revoked) await database.upsertAiNovelBillingTransaction(alipayTransaction(order, now.toISOString()));
    if (order.status === "paid") await rebuildAlipayEntitlements(database, order.userId, now);
    return (await database.findAiNovelAlipayOrder(order.orderId))!;
  }));
}
function reject(): never { throw new ApplicationError(400, "BILLING_EVIDENCE_MISMATCH", "Alipay settlement evidence is invalid."); }
