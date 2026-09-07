import type { BodyLogGroupStore } from "../../infrastructure/bodylog-store-ports.ts";
import { randomId } from "../../shared/utils.ts";
import { BODYLOG_APP_ID } from "./bodylog-profile.types.ts";
import type {
  CheckInGroupRecord,
  GroupActivityRecord,
  CheckInGroupTier,
} from "./bodylog-group.types.ts";
import {
  GROUP_TIER_THRESHOLDS,
  GROUP_TIER_REWARDS,
} from "./bodylog-group.types.ts";
import type { NotificationService } from "../../services/notification.service.ts";
import { buildGroupNotificationPayload, type GroupNotificationType } from "./bodylog-group-notification.ts";
import { SubscriptionService } from "../../services/subscription.service.ts";
import { SubscriptionTier } from "../../services/subscription.service.ts";

const DAY_MS = 86_400_000;

/**
 * Scheduled settlement logic for check-in groups, extracted from
 * BodyLogGroupService so the service stays focused on request handling.
 */
export class BodyLogGroupSettlement {
  constructor(
    private readonly store: BodyLogGroupStore,
    private readonly notificationService?: NotificationService,
    private readonly subscriptionService?: SubscriptionService,
  ) {}

  /**
   * 每日结算 - 计算小组连续天数
   */
  async dailySettlement(): Promise<void> {
    const now = new Date();
    const yesterday = new Date(now.getTime() - DAY_MS).toISOString().split("T")[0];

    // 获取所有active的小组
    const allGroups = await this.store.listAllCheckInGroups(BODYLOG_APP_ID);
    const activeGroups = allGroups.filter((group) => group.status === "active");

    for (const group of activeGroups) {
      const dailyRecord = await this.store.findGroupDailyRecord(group.id, yesterday);

      let bothCompleted = false;

      if (dailyRecord) {
        if (group.completionRule === "all") {
          // 全员完成规则
          bothCompleted = dailyRecord.totalMembers > 0 && dailyRecord.completedCount >= dailyRecord.totalMembers;
        } else if (group.completionRule === "majority") {
          // 多数人完成规则
          bothCompleted = dailyRecord.totalMembers > 0 && dailyRecord.completedCount > dailyRecord.totalMembers / 2;
        }
      }

      let updatedGroup: CheckInGroupRecord = { ...group };

      if (bothCompleted) {
        // 连续天数+1
        updatedGroup.consecutiveDays += 1;
        updatedGroup.maxConsecutive = Math.max(updatedGroup.maxConsecutive, updatedGroup.consecutiveDays);
        if (!group.lastActiveDate || group.lastActiveDate < yesterday) updatedGroup.lastActiveDate = yesterday;

        // 检查是否达到新的等级
        const newTier = this.calculateTier(updatedGroup.consecutiveDays);
        if (newTier !== updatedGroup.currentTier) {
          updatedGroup.currentTier = newTier;

          // 创建里程碑活动记录
          const milestoneActivity: GroupActivityRecord = {
            id: randomId("group_activity"),
            groupId: group.id,
            actorUserId: "system",
            type: "milestone",
            targetHabitId: null,
            payload: { tier: newTier, consecutiveDays: updatedGroup.consecutiveDays },
            createdAt: now.toISOString(),
          };
          await this.store.insertGroupActivity(milestoneActivity);

          // 奖励Premium天数给所有成员（如果是金牌及以上）
          const rewardDays = GROUP_TIER_REWARDS[newTier];
          if (rewardDays > 0) {
            const members = await this.store.listGroupMembers(group.id);
            const activeMembers = members.filter((m) => m.status === "active");
            for (const member of activeMembers) {
              await this.grantPremiumReward(member.userId, rewardDays);
              // 发送等级提升通知
              await this.sendGroupNotification(member.userId, "group_tier_upgraded", group.id, undefined, undefined, newTier);
            }
          }
        }
      } else {
        // 连续天数归零
        updatedGroup.consecutiveDays = 0;
      }

      updatedGroup.updatedAt = now.toISOString();
      await this.store.updateCheckInGroup(updatedGroup);
    }
  }

  /**
   * 每周结算 - 生成周报和排名
   */
  async weeklySettlement(): Promise<void> {
    const now = new Date();
    const allGroups = await this.store.listAllCheckInGroups(BODYLOG_APP_ID);
    const activeGroups = allGroups.filter((group) => group.status === "active");
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString().split("T")[0];

    for (const group of activeGroups) {
      const recentActivities = await this.store.listGroupActivities(group.id, 100);
      if (recentActivities.some((activity) =>
        activity.type === "milestone" &&
        activity.payload.reportType === "weekly" &&
        activity.payload.weekStart === weekAgo
      )) continue;
      const members = await this.store.listGroupMembers(group.id);
      const activeMembers = members.filter((m) => m.status === "active");

      // 获取本周的每日记录
      const dailyRecords = (await this.store.listGroupDailyRecordsSince(group.id, weekAgo))
        .filter(record => record.date < now.toISOString().split('T')[0]);

      // 计算每个成员的完成率
      const memberCompletionCounts = new Map<string, number>();
      for (const member of activeMembers) {
        memberCompletionCounts.set(member.userId, 0);
      }

      for (const record of dailyRecords) {
        for (const userId of record.completedUserIds) {
          const currentCount = memberCompletionCounts.get(userId) ?? 0;
          memberCompletionCounts.set(userId, currentCount + 1);
        }
      }

      // 创建周报活动记录
      const weeklyReportActivity: GroupActivityRecord = {
        id: randomId("group_activity"),
        groupId: group.id,
        actorUserId: "system",
        type: "milestone",
        targetHabitId: null,
        payload: {
          reportType: "weekly",
          weekStart: weekAgo,
          totalDays: dailyRecords.length,
          memberStats: Array.from(memberCompletionCounts.entries()).map(([userId, count]) => ({
            userId,
            completionDays: count,
            completionRate: (count / 7) * 100,
          })),
          groupConsecutiveDays: group.consecutiveDays,
        },
        createdAt: now.toISOString(),
      };
      await this.store.insertGroupActivity(weeklyReportActivity);
    }
  }

  /**
   * 计算等级
   */
  private calculateTier(consecutiveDays: number): CheckInGroupTier | null {
    if (consecutiveDays >= GROUP_TIER_THRESHOLDS.diamond) return "diamond";
    if (consecutiveDays >= GROUP_TIER_THRESHOLDS.platinum) return "platinum";
    if (consecutiveDays >= GROUP_TIER_THRESHOLDS.gold) return "gold";
    if (consecutiveDays >= GROUP_TIER_THRESHOLDS.silver) return "silver";
    if (consecutiveDays >= GROUP_TIER_THRESHOLDS.bronze) return "bronze";
    return null;
  }

  /**
   * 辅助方法：授予Premium奖励
   */
  private async grantPremiumReward(userId: string, days: number): Promise<void> {
    if (!this.subscriptionService) {
      console.warn("Subscription service not available, skipping premium reward");
      return;
    }

    try {
      await this.subscriptionService.grantReward(
        BODYLOG_APP_ID,
        userId,
        SubscriptionTier.PLUS,
        days,
        "Group tier reward"
      );
    } catch (error) {
      console.error("Failed to grant premium reward:", error);
    }
  }

  /**
   * 辅助方法：发送小组通知
   */
  private async sendGroupNotification(
    recipientUserId: string,
    type: GroupNotificationType,
    groupId: string,
    userId?: string,
    habitId?: string,
    tier?: string,
  ): Promise<void> {
    if (!this.notificationService) return;

    const payload = buildGroupNotificationPayload({
      type,
      groupId,
      userId,
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
      console.error("Failed to send group notification:", error);
    }
  }
}
