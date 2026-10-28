import { createHash } from "node:crypto";
import type { BodyLogRetentionStore } from "../../infrastructure/bodylog-retention-store.ts";
import type { BodyLogSubscriptionStore } from "../../infrastructure/bodylog-store-ports.ts";

export interface RewardGrant {
  id: string; userId: string; source: string; sourceId: string; type: "premium" | "badge";
  value: string; startsAt: string; endsAt: string | null; createdAt: string;
}
/** Call within the application's exclusive transaction, including source qualification. */
export class BodyLogRewardLedger {
  constructor(private readonly store: BodyLogRetentionStore, private readonly subscriptions: BodyLogSubscriptionStore) {}
  async grants(userId: string): Promise<RewardGrant[]> {
    return (await this.store.list("grant", userId)).map(item => item.data as unknown as RewardGrant);
  }
  async grant(userId: string, source: string, sourceId: string, type: "premium" | "badge", value: string, days = 0): Promise<RewardGrant> {
    const id = "grant_" + createHash("sha256").update(JSON.stringify([userId, source, sourceId])).digest("hex");
    const all = await this.grants(userId);
    const prior = all.find(item => item.id === id);
    if (prior) return prior;
    const now = new Date();
    const subscription = await this.subscriptions.findActiveUserSubscription("bodylog", userId);
    const start = type === "premium" ? Math.max(now.getTime(),
      subscription && subscription.tier !== "free" ? Date.parse(subscription.expiresAt) || 0 : 0,
      ...all.filter(item => item.type === "premium").map(item => Date.parse(item.endsAt ?? "") || 0)) : now.getTime();
    const grant: RewardGrant = { id, userId, source, sourceId, type, value, startsAt: new Date(start).toISOString(),
      endsAt: type === "premium" ? new Date(start + days * 86_400_000).toISOString() : null, createdAt: now.toISOString() };
    await this.store.save({ id, userId, kind: "grant", data: { ...grant } });
    return grant;
  }
  async entitlements(userId: string) {
    const subscription = await this.subscriptions.findActiveUserSubscription("bodylog", userId);
    const now = Date.now();
    const paid = subscription && subscription.tier !== "free" && Date.parse(subscription.expiresAt) > now ? subscription : null;
    const grants = (await this.grants(userId)).filter(item => item.type === "premium");
    const promotional = grants.map(item => ({ ...item, campaignId: item.source === "campaign" ? item.sourceId : "",
      participationId: item.sourceId, status: Date.parse(item.endsAt ?? "") <= now ? "expired" : Date.parse(item.startsAt) > now ? "queued" : "active" }));
    const active = promotional.filter(item => item.status === "active");
    // A queued grant extends an active interval, but is not itself a current entitlement.
    const hasCurrent = Boolean(paid) || active.length > 0;
    let until = hasCurrent ? Math.max(paid ? Date.parse(paid.expiresAt) : now, ...active.map(item => Date.parse(item.endsAt ?? ""))) : 0;
    for (const interval of [...promotional].sort((a,b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))) {
      if (until && Date.parse(interval.startsAt) <= until && Date.parse(interval.endsAt ?? "") > until) until = Date.parse(interval.endsAt!);
    }
    return { effective: { isPremium: hasCurrent, sources: [...new Set([...(paid ? ["subscription"] : []), ...active.map(item => item.source)])],
      premiumUntil: until ? new Date(until).toISOString() : null }, promotional };
  }
}
