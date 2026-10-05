import { ApplicationError } from "../shared/errors.ts";
import type { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import type { AlipayOptions, AlipayOrder } from "../modules/billing/alipay-models.ts";
import { addMembershipPeriod, alipayPaidAt, membershipConflict, parseAlipayMoney } from "../modules/billing/alipay-policy.ts";
import { alipayTransaction, refreshAlipayMembership } from "./ainovel-alipay-projection.ts";

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
    if (order.status === "paid") return order;
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
      const account = await database.findAppUser("ai_novel", order.userId);
      if (!account || account.status === "DELETED") order.accountDeletedAt ??= account?.updatedAt ?? now.toISOString();
      const current = await database.findAiNovelBillingMembership("ai_novel", order.userId);
      order.conflict = membershipConflict(current, order.productKey, now);
      if (!order.accountDeletedAt && !current?.accountDeletedAt && !order.conflict) {
        const access = await database.listAiNovelAlipayAccess(order.userId, paidAt);
        const sameTier = access.find(item => item.productKey.split("_")[0] === order.productKey.split("_")[0]);
        const start = new Date(Math.max(Date.parse(paidAt), Date.parse(sameTier?.membershipExpiresAt ?? paidAt)));
        order.membershipExpiresAt = addMembershipPeriod(start, order.productKey);
        order.membershipApplied = true;
      }
    }
    // Save first: uniqueness failures happen before any in-memory projection mutations.
    await database.saveAiNovelAlipayOrder(order);
    await database.upsertAiNovelBillingTransaction(alipayTransaction(order, now.toISOString()));
    if (order.membershipApplied) {
      // An expired RC projection must not prevent an authorized first Alipay grant.
      const current = await database.findAiNovelBillingMembership("ai_novel", order.userId);
      if (current?.source !== "alipay") await database.upsertAiNovelBillingMembership({
        appId: "ai_novel", userId: order.userId, source: "alipay", active: false, state: "expired", tier: null,
        planKey: null, expiresAt: null, autoRenew: false, managementUrl: null, accountDeletedAt: null, lastSyncedAt: now.toISOString() });
      await refreshAlipayMembership(database, order.userId, now);
    }
    return order;
  });
}
function reject(): never { throw new ApplicationError(400, "BILLING_EVIDENCE_MISMATCH", "Alipay settlement evidence is invalid."); }
