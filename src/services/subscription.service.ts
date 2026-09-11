import type { BodyLogSubscriptionStore } from "../infrastructure/bodylog-store-ports.ts";
import type { UserSubscriptionRecord } from "../modules/bodylog/bodylog-subscription.types.ts";
import { randomId } from "../shared/utils.ts";

export enum SubscriptionTier {
  FREE = "free",
  PLUS = "plus",
  PRO = "pro",
}

export enum SubscriptionEventType {
  CREATED = "created",
  RENEWED = "renewed",
  CANCELLED = "cancelled",
  EXPIRED = "expired",
  UPGRADED = "upgraded",
  REWARD_GRANTED = "reward_granted",
}

/**
 * 用户订阅服务
 * 负责查询用户订阅状态、授予订阅奖励
 */
export class SubscriptionService {
  constructor(private readonly database: BodyLogSubscriptionStore) {}

  /**
   * 检查用户是否为 Premium（Plus 或 Pro）
   */
  async isPremium(appId: string, userId: string): Promise<boolean> {
    const subscription = await this.getActiveSubscription(appId, userId);
    if (!subscription) return false;
    return subscription.tier === SubscriptionTier.PLUS || subscription.tier === SubscriptionTier.PRO;
  }

  /**
   * 获取用户当前有效的订阅
   */
  async getActiveSubscription(appId: string, userId: string): Promise<UserSubscriptionRecord | null> {
    return await this.database.findActiveUserSubscription(appId, userId);
  }

  /**
   * 授予用户 Premium 订阅奖励
   * 如果已有订阅且未过期，则延长到期时间
   * 如果没有订阅或已过期，则创建新订阅
   */
  async grantReward(
    appId: string,
    userId: string,
    tier: SubscriptionTier,
    days: number,
    reason: string,
  ): Promise<void> {
    const existing = await this.getActiveSubscription(appId, userId);
    const now = new Date();
    const daysMs = days * 24 * 60 * 60 * 1000;

    if (existing) {
      // 已有有效订阅，延长到期时间
      const currentExpiry = new Date(existing.expiresAt);
      const newExpiry = new Date(currentExpiry.getTime() + daysMs);

      const updatedRecord = {
        ...existing,
        expiresAt: newExpiry.toISOString(),
        updatedAt: now.toISOString(),
      };

      await this.database.upsertUserSubscription(updatedRecord);

      // 记录事件
      await this.recordEvent(existing.id, SubscriptionEventType.RENEWED, tier, {
        reason,
        days_added: days,
        old_expiry: currentExpiry.toISOString(),
        new_expiry: newExpiry.toISOString(),
      });
    } else {
      // 无有效订阅，创建新订阅
      const expiry = new Date(now.getTime() + daysMs);
      const subscriptionId = randomId();

      const newRecord = {
        id: subscriptionId,
        appId,
        userId,
        tier,
        startedAt: now.toISOString(),
        expiresAt: expiry.toISOString(),
        originalTransactionId: null,
        autoRenew: false,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };

      await this.database.upsertUserSubscription(newRecord);

      // 记录事件
      await this.recordEvent(subscriptionId, SubscriptionEventType.CREATED, tier, {
        reason,
        days,
        expiry: expiry.toISOString(),
      });
    }
  }

  /**
   * 记录订阅事件
   */
  private async recordEvent(
    subscriptionId: string,
    eventType: SubscriptionEventType,
    tier: SubscriptionTier,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const eventId = randomId();
    const event = {
      id: eventId,
      subscriptionId,
      eventType,
      tier,
      metadata,
      occurredAt: new Date().toISOString(),
    };
    await this.database.insertSubscriptionEvent(event);
  }
}
