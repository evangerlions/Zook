import type { AlipayOrder } from "../modules/billing/alipay-models.ts";
export class InMemoryAlipayOrders {
  readonly orders = new Map<string, AlipayOrder>();
  findOrder(id: string) { const order = this.orders.get(id); return order && structuredClone(order); }
  findIdempotency(user: string, key: string) { return [...this.orders.values()].find(order => order.userId === user && order.idempotencyKey === key); }
  listAccess(user: string, now: string) {
    const tiers = new Map<string, AlipayOrder>();
    for (const order of this.orders.values()) {
      if (order.userId !== user || !order.membershipApplied || order.accountDeletedAt || !order.membershipExpiresAt || order.membershipExpiresAt <= now) continue;
      const tier = order.productKey.split("_")[0];
      if (!tiers.has(tier) || tiers.get(tier)!.membershipExpiresAt! < order.membershipExpiresAt) tiers.set(tier, order);
    }
    return structuredClone([...tiers.values()]);
  }
  save(order: AlipayOrder) {
    for (const other of this.orders.values()) {
      if (other.orderId !== order.orderId && ((other.userId === order.userId && other.idempotencyKey === order.idempotencyKey) ||
        (order.providerTransactionId && order.environment === other.environment && order.providerTransactionId === other.providerTransactionId))) throw new Error("Duplicate Alipay identity");
    }
    this.orders.set(order.orderId, structuredClone(order));
  }
  softDelete(user: string, at: string) { for (const order of this.orders.values()) if (order.userId === user) order.accountDeletedAt ??= at; }
}
