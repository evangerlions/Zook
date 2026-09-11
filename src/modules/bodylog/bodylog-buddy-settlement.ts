import type { BodyLogBuddyStore } from "../../infrastructure/bodylog-store-ports.ts";
import { randomId } from "../../shared/utils.ts";
import { BODYLOG_APP_ID } from "./bodylog-profile.types.ts";
import type {
  BuddyPairRecord,
  BuddyActivityRecord,
  BuddyTier,
} from "./bodylog-buddy.types.ts";
import {
  BUDDY_TIER_THRESHOLDS,
  BUDDY_TIER_REWARDS,
  BUDDY_INACTIVITY_THRESHOLDS,
} from "./bodylog-buddy.types.ts";
import {
  buildBodyLogBuddyNotificationPayload,
  type BodyLogBuddyNotificationType,
} from "./bodylog-buddy-notification.ts";
import type { NotificationService } from "../../services/notification.service.ts";
import type { SubscriptionService } from "../../services/subscription.service.ts";
import { SubscriptionTier } from "../../services/subscription.service.ts";

const DAY_MS = 86_400_000;

/**
 * Scheduled settlement logic for buddy pairs, extracted from
 * BodyLogBuddyService so the service stays focused on request handling.
 */
export class BodyLogBuddySettlement {
  constructor(
    private readonly store: BodyLogBuddyStore,
    private readonly notificationService?: NotificationService,
    private readonly subscriptionService?: SubscriptionService,
  ) {}

  /**
   * 每日结算 - 计算连续天数
   */
  async dailySettlement(): Promise<void> {
    const now = new Date();
    const yesterday = new Date(now.getTime() - DAY_MS).toISOString().split("T")[0];

    // 获取所有active的搭子配对
    const allPairs = await this.store.listAllBodyLogBuddyPairs(BODYLOG_APP_ID);
    const activePairs = allPairs.filter((pair) => pair.status === "active");

    for (const pair of activePairs) {
      // 检查双方昨天是否都完成了至少一个共同习惯
      const activities = await this.store.listBodyLogBuddyActivities(pair.id);
      const yesterdayActivities = activities.filter((activity) => {
        const activityDate = activity.createdAt.split("T")[0];
        return activityDate === yesterday && activity.type === "checked_in";
      });

      // 统计每个用户完成的共同习惯
      const userIdCompletedHabits = new Set<string>();
      const partnerIdCompletedHabits = new Set<string>();

      for (const activity of yesterdayActivities) {
        if (activity.targetHabitId && pair.sharedHabitIds.includes(activity.targetHabitId)) {
          if (activity.actorUserId === pair.userId) {
            userIdCompletedHabits.add(activity.targetHabitId);
          } else if (activity.actorUserId === pair.partnerUserId) {
            partnerIdCompletedHabits.add(activity.targetHabitId);
          }
        }
      }

      // 判断是否双方都完成了至少一个共同习惯
      const bothCompleted = userIdCompletedHabits.size > 0 && partnerIdCompletedHabits.size > 0;

      let updatedPair: BuddyPairRecord = { ...pair };

      if (bothCompleted) {
        // 连续天数+1
        updatedPair.consecutiveDays += 1;
        updatedPair.maxConsecutive = Math.max(updatedPair.maxConsecutive, updatedPair.consecutiveDays);
        if (!pair.lastActiveDate || pair.lastActiveDate < yesterday) updatedPair.lastActiveDate = yesterday;

        // 检查是否达到新的等级
        const newTier = this.calculateTier(updatedPair.consecutiveDays);
        if (newTier !== updatedPair.currentTier) {
          updatedPair.currentTier = newTier;

          // 创建里程碑活动记录
          const milestoneActivity: BuddyActivityRecord = {
            id: randomId("buddy_activity"),
            pairId: pair.id,
            actorUserId: "system",
            type: "milestone",
            targetHabitId: null,
            payload: { tier: newTier, consecutiveDays: updatedPair.consecutiveDays },
            createdAt: now.toISOString(),
          };
          await this.store.insertBodyLogBuddyActivity(milestoneActivity);

          // 发送等级提升通知给双方
          await this.sendBuddyNotification(pair.userId, "buddy_tier_upgraded", pair.id, pair.partnerUserId, undefined, newTier);
          await this.sendBuddyNotification(pair.partnerUserId, "buddy_tier_upgraded", pair.id, pair.userId, undefined, newTier);

          // 奖励Premium天数（如果是金牌及以上）
          const rewardDays = BUDDY_TIER_REWARDS[newTier];
          if (rewardDays > 0) {
            await this.grantPremiumReward(pair.userId, rewardDays);
            await this.grantPremiumReward(pair.partnerUserId, rewardDays);
          }
        }
      } else {
        // 检查是否双方都未完成（连续天数归零）
        updatedPair.consecutiveDays = 0;
      }

      updatedPair.updatedAt = now.toISOString();
      await this.store.updateBodyLogBuddyPair(updatedPair);
    }
  }

  /**
   * 自动解除不活跃的搭子关系
   */
  async autoDissolveInactivePairs(): Promise<void> {
    const now = new Date();
    const allPairs = await this.store.listAllBodyLogBuddyPairs(BODYLOG_APP_ID);
    const activePairs = allPairs.filter((pair) => pair.status === "active");

    for (const pair of activePairs) {
      // 检查最后活跃日期
      if (!pair.lastActiveDate) continue;

      const lastActive = new Date(pair.lastActiveDate);
      const daysSinceActive = (now.getTime() - lastActive.getTime()) / DAY_MS;

      // 发送警告（7天未活跃）
      if (daysSinceActive >= BUDDY_INACTIVITY_THRESHOLDS.WARNING_DAYS &&
          daysSinceActive < BUDDY_INACTIVITY_THRESHOLDS.AUTO_DISSOLVE_DAYS) {
        // TODO: 发送提醒通知
        continue;
      }

      // 自动解除（14天未活跃）
      if (daysSinceActive >= BUDDY_INACTIVITY_THRESHOLDS.AUTO_DISSOLVE_DAYS) {
        const updatedPair: BuddyPairRecord = {
          ...pair,
          status: "dissolved",
          dissolvedAt: now.toISOString(),
          updatedAt: now.toISOString(),
        };
        await this.store.updateBodyLogBuddyPair(updatedPair);
      }
    }
  }

  /**
   * 计算等级
   */
  private calculateTier(consecutiveDays: number): BuddyTier | null {
    if (consecutiveDays >= BUDDY_TIER_THRESHOLDS.legend) return "legend";
    if (consecutiveDays >= BUDDY_TIER_THRESHOLDS.diamond) return "diamond";
    if (consecutiveDays >= BUDDY_TIER_THRESHOLDS.gold) return "gold";
    if (consecutiveDays >= BUDDY_TIER_THRESHOLDS.silver) return "silver";
    if (consecutiveDays >= BUDDY_TIER_THRESHOLDS.copper) return "copper";
    return null;
  }

  /**
   * 辅助方法：授予Premium奖励
   */
  private async grantPremiumReward(userId: string, days: number): Promise<void> {
    if (!this.subscriptionService) return;
    try {
      await this.subscriptionService.grantReward(BODYLOG_APP_ID, userId, SubscriptionTier.PLUS, days, "BodyLog buddy tier reward");
    } catch (error) {
      console.error("Failed to grant buddy premium reward:", error);
    }
  }

  /**
   * 辅助方法：发送搭子通知
   */
  private async sendBuddyNotification(
    recipientUserId: string,
    type: BodyLogBuddyNotificationType,
    pairId?: string,
    partnerUserId?: string,
    habitId?: string,
    tier?: string,
  ): Promise<void> {
    if (!this.notificationService) return;

    const payload = buildBodyLogBuddyNotificationPayload({
      type,
      pairId,
      partnerUserId,
      habitId,
      tier,
    });

    try {
      await this.notificationService.queueNotification({
        appId: BODYLOG_APP_ID,
        recipientUserId,
        channel: "push",
        payload: payload as unknown as Record<string, unknown>,
      });
    } catch (error) {
      // 通知发送失败不应影响主流程
      console.error("Failed to send buddy notification:", error);
    }
  }
}
