import type { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import type { AlipayOrder } from "../modules/billing/alipay-models.ts";
import { billingEnvironment } from "../modules/billing/billing-environment.ts";
import { addMembershipPeriod, membershipConflict } from "../modules/billing/alipay-policy.ts";
import { anchorMembershipCredits } from "../modules/billing/billing-credit-window.ts";
import { alipayTransaction, readAlipayMembership } from "./ainovel-alipay-projection.ts";

export async function* userAlipayOrders(database: ApplicationDatabase, userId: string, before: string) {
  let after: string | undefined;
  for (;;) {
    const page = await database.listAiNovelAlipayOrders(userId, { before, after, limit: 20 });
    for (const order of page) yield order;
    if (page.length < 20) return;
    after = page.at(-1)!.orderId;
  }
}
/** Called only inside the canonical settlement transaction. Never contacts a provider. */
export async function rebuildAlipayEntitlements(database: ApplicationDatabase, userId: string, now: Date) {
  const account = await database.findAppUser("ai_novel", userId);
  const current = await database.findAiNovelBillingMembership("ai_novel", userId);
  const transactions = (await database.listAiNovelBillingTransactions("ai_novel", userId))
    .filter(t => t.isSandbox === (billingEnvironment() === "sandbox"));
  const revoked = new Set(transactions.filter(t => t.status === "refunded" || t.status === "revoked").map(t => t.providerTransactionId));
  const paid: AlipayOrder[] = [];
  for await (const order of userAlipayOrders(database, userId, now.toISOString())) {
    if (order.status === "paid" && order.paidAt) paid.push(order);
  }
  paid.sort((a,b) => a.paidAt!.localeCompare(b.paidAt!) || a.orderId.localeCompare(b.orderId));
  const ends = new Map<string, string>();
  for (const order of paid) {
    const previous = JSON.stringify(order);
    const deleted = !account || account.status === "DELETED" || !!current?.accountDeletedAt || !!order.accountDeletedAt;
    if (deleted) order.accountDeletedAt ??= account?.updatedAt ?? now.toISOString();
    // An existing authorized payment stays authorized even after provider configuration changes.
    const conflict = order.membershipApplied ? null : membershipConflict(current, order.productKey, now);
    order.conflict = conflict;
    if (deleted || revoked.has(order.orderId) || conflict) {
      order.membershipApplied = false;
      order.membershipStartsAt = null;
      order.membershipExpiresAt = null;
    } else {
      const tier = order.productKey.split("_")[0];
      const start = new Date(Math.max(Date.parse(order.paidAt!), Date.parse(ends.get(tier) ?? order.paidAt!)));
      order.membershipStartsAt = start.toISOString();
      order.membershipExpiresAt = addMembershipPeriod(start, order.productKey);
      order.membershipApplied = true;
      ends.set(tier, order.membershipExpiresAt);
    }
    if (JSON.stringify(order) !== previous) await database.saveAiNovelAlipayOrder(order);
    if (!revoked.has(order.orderId)) await database.upsertAiNovelBillingTransaction(alipayTransaction(order, now.toISOString()));
  }
  if (current?.accountDeletedAt || (current?.source !== "alipay" && current?.active && current.expiresAt && current.expiresAt > now.toISOString())) return;
  if ((!current || current.source !== "alipay") && paid.some(o => o.membershipApplied)) {
    const last = paid.filter(o => o.membershipApplied).at(-1)!;
    await database.upsertAiNovelBillingMembership({ appId: "ai_novel", userId, source: "alipay", active: false,
      state: "expired", tier: null, planKey: null, expiresAt: last.membershipExpiresAt,
      autoRenew: false, managementUrl: null, lastSyncedAt: now.toISOString(), accountDeletedAt: null });
  }
  const local = await readAlipayMembership(database, userId, now, true);
  if (!local) return;
  const merged = (await database.listAiNovelBillingTransactions("ai_novel", userId)).filter(t => t.isSandbox === (billingEnvironment() === "sandbox"));
  await database.upsertAiNovelBillingMembership(anchorMembershipCredits(current, { ...local, lastSyncedAt: now.toISOString() }, merged));
}
