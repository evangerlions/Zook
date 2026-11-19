import { billingEnvironment } from "../modules/billing/billing-environment.ts";
import type { AlipayOrder } from "../modules/billing/alipay-models.ts";
export class InMemoryAlipayOrders {
  readonly orders = new Map<string, AlipayOrder>();
  findOrder(id: string) { const order = this.orders.get(id); return order && structuredClone(order); }
  findIdempotency(user: string, key: string) { return [...this.orders.values()].find(order => order.userId === user && order.idempotencyKey === key && order.environment === billingEnvironment()); }
  listRecovery(environment: string, merchant: string, seller: string, limit: number, accessRevoked: (order: AlipayOrder) => boolean) {
    return structuredClone([...this.orders.values()].filter(order =>
      order.environment === environment && order.merchantAppId === merchant && order.sellerId === seller &&
      (order.status === "pending" || (order.status === "paid" && !order.membershipApplied && !order.accountDeletedAt && !accessRevoked(order))))
      .sort((a, b) => (a.lastRecoveryAt ?? a.createdAt).localeCompare(b.lastRecoveryAt ?? b.createdAt) || a.orderId.localeCompare(b.orderId))
      .slice(0, limit));
  }
  listOrders(user: string, filter: { before: string; after?: string; limit: number }) {
    return structuredClone([...this.orders.values()].filter(o => o.userId === user && o.environment === billingEnvironment() &&
      o.createdAt <= filter.before && (!filter.after || o.orderId > filter.after))
      .sort((a,b) => a.orderId.localeCompare(b.orderId)).slice(0, filter.limit));
  }
  listAccess(user: string, now: string) {
    const tiers = new Map<string, AlipayOrder>();
    for (const order of this.orders.values()) {
      if (order.environment !== billingEnvironment() || order.userId !== user || order.status !== "paid" || !order.membershipApplied || !order.membershipStartsAt || order.accountDeletedAt || !order.membershipExpiresAt || order.membershipExpiresAt <= now) continue;
      const tier = order.productKey.split("_")[0];
      if (!tiers.has(tier) || tiers.get(tier)!.membershipExpiresAt! < order.membershipExpiresAt) tiers.set(tier, order);
    }
    return structuredClone([...tiers.values()].filter(best => [...this.orders.values()].some(o =>
      o.userId === user && o.environment === billingEnvironment() && o.membershipApplied && !o.accountDeletedAt &&
      o.status === "paid" && o.productKey.split("_")[0] === best.productKey.split("_")[0] &&
      !!o.membershipStartsAt && o.membershipStartsAt <= now && !!o.membershipExpiresAt && o.membershipExpiresAt > now)));
  }
  save(order: AlipayOrder) {
    for (const other of this.orders.values()) {
      if (other.orderId !== order.orderId && ((other.userId === order.userId && other.environment === order.environment && other.idempotencyKey === order.idempotencyKey) ||
        (order.providerTransactionId && order.environment === other.environment && order.providerTransactionId === other.providerTransactionId))) throw new Error("Duplicate Alipay identity");
    }
    this.orders.set(order.orderId, structuredClone(order));
  }
  softDelete(user: string, at: string) { for (const order of this.orders.values()) if (order.userId === user) order.accountDeletedAt ??= at; }
}
