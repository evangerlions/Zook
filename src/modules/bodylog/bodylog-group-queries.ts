import type { BodyLogGroupStore, BodyLogSocialAccess } from "../../infrastructure/bodylog-store-ports.ts";
import { ApplicationError } from "../../shared/errors.ts";

import { BODYLOG_APP_ID } from "./bodylog-profile.types.ts";
import type {
  CheckInGroup,
} from "./bodylog-group.types.ts";

import { SubscriptionService } from "../../services/subscription.service.ts";

const DAY_MS = 86_400_000;

/**
 * 获取用户的小组列表
 */
export async function getMyGroups(store: BodyLogGroupStore, social: BodyLogSocialAccess, userId: string): Promise<CheckInGroup[]> {
  const groups = await store.listCheckInGroupsByUser(BODYLOG_APP_ID, userId);
  const activeGroups = groups.filter(group => group.status === "active");

  if (activeGroups.length === 0) {
    return [];
  }

  // 批量查询所有群的成员
  const groupIds = activeGroups.map(g => g.id);
  const membersByGroup = await store.listGroupMembersByGroupIds(groupIds);

  // 批量查询所有群主的资料
  const leaderUserIds = [...new Set(activeGroups.map(g => g.leaderUserId))];
  const profilesById = await social.listBodyLogProfilesByIds(BODYLOG_APP_ID, leaderUserIds);

  const result: CheckInGroup[] = [];

  for (const group of activeGroups) {
    const members = membersByGroup.get(group.id) || [];
    const activeMembers = members.filter((m) => m.status === "active");
    const leaderProfile = profilesById.get(group.leaderUserId);
    if (!leaderProfile) continue;

    result.push({
      id: group.id,
      name: group.name,
      icon: group.icon,
      leaderUserId: group.leaderUserId,
      leaderNickname: leaderProfile.nickname,
      leaderAvatarKey: leaderProfile.avatarKey,
      sharedHabitIds: group.sharedHabitIds,
      completionRule: group.completionRule,
      maxMembers: group.maxMembers,
      currentMembers: activeMembers.length,
      status: group.status,
      consecutiveDays: group.consecutiveDays,
      maxConsecutive: group.maxConsecutive,
      currentTier: group.currentTier,
      lastActiveDate: group.lastActiveDate,
      createdAt: group.createdAt,
    });
  }

  return result;
}

/**
 * 获取群组排行榜
 */
export async function getGroupLeaderboard(store: BodyLogGroupStore, social: BodyLogSocialAccess, userId: string, groupId: string): Promise<{
  groupId: string;
  groupName: string;
  entries: Array<{
    rank: number;
    userId: string;
    nickname: string;
    avatarKey: string;
    score: number;
    effectiveDays: number;
    completedInstances: number;
    streakDays: number;
  }>;
  stats: {
    totalMembers: number;
    avgScore: number;
    totalStreakDays: number;
    weeklyCompletionRate: number;
  };
  currentUserId: string;
  updatedAt: string;
}> {
  const group = await store.findCheckInGroup(groupId);
  if (!group) {
    throw new ApplicationError(404, "GROUP_NOT_FOUND", "Group not found.");
  }

  const member = await store.findGroupMember(groupId, userId);
  if (!member || member.status !== "active") {
    throw new ApplicationError(403, "GROUP_NOT_MEMBER", "Not a member of this group.");
  }

  // 获取所有活跃成员
  const members = await store.listGroupMembers(groupId);
  const activeMembers = members.filter((m) => m.status === "active");

  // 获取最近 7 天（含今天）的每日记录；
  // 用 -6 天使 [weekAgo, today] 恰好是 7 个自然日，与分数/连续天数口径一致。
  const weekAgo = new Date(Date.now() - 6 * DAY_MS).toISOString().split("T")[0];
  const dailyRecords = (await store.listGroupDailyRecordsSince(groupId, weekAgo))
    .filter((r) => r.date <= new Date().toISOString().split("T")[0]);

  // 计算每个成员的统计数据
  const memberStats = new Map<string, {
    completedDays: number;
    totalCompletions: number;
    currentStreak: number;
    maxStreak: number;
  }>();

  for (const member of activeMembers) {
    memberStats.set(member.userId, {
      completedDays: 0,
      totalCompletions: 0,
      currentStreak: 0,
      maxStreak: 0,
    });
  }

  // 统计每个成员的完成情况
  for (const record of dailyRecords) {
    for (const completedUserId of record.completedUserIds) {
      const stats = memberStats.get(completedUserId);
      if (stats) {
        stats.completedDays++;
        stats.totalCompletions++;
      }
    }
  }

  // 构建日期 → 记录索引，避免循环内 O(n) find()
  const recordsByDate = new Map(dailyRecords.map((r) => [r.date, r]));

  // 计算连续打卡天数（简化版：基于最近 7 天，从今天往前数）
  for (const [memberUserId, stats] of memberStats.entries()) {
    let currentStreak = 0;

    // 连续天数必须从今天（或昨天，若今天尚未打卡）起算。
    // 如果今天没打卡，今天不算断签，从昨天开始往前数；一旦遇到未打卡日则中断。
    for (let i = 0; i < 7; i++) {
      const date = new Date(Date.now() - i * DAY_MS).toISOString().split("T")[0];
      const record = recordsByDate.get(date);

      if (record && record.completedUserIds.includes(memberUserId)) {
        currentStreak++;
      } else if (i === 0) {
        // 今天尚未打卡不算断签，继续从昨天数起
        continue;
      } else {
        // 中间出现未打卡日，中断
        break;
      }
    }

    stats.currentStreak = currentStreak;
    stats.maxStreak = Math.max(stats.maxStreak, currentStreak);
  }

  // 计算分数并排序
  const entries = Array.from(memberStats.entries())
    .map(([memberUserId, stats]) => {
      // 分数计算：完成天数 * 10 + 总完成次数 + 连续天数 * 5
      const score = stats.completedDays * 10 + stats.totalCompletions + stats.currentStreak * 5;
      return { memberUserId, stats, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((item, index) => ({
      rank: index + 1,
      userId: item.memberUserId,
      nickname: "", // 稍后填充
      avatarKey: "", // 稍后填充
      score: item.score,
      effectiveDays: item.stats.completedDays,
      completedInstances: item.stats.totalCompletions,
      streakDays: item.stats.currentStreak,
    }));

  // 批量填充用户信息
  const userIds = entries.map(e => e.userId);
  const profilesById = await social.listBodyLogProfilesByIds(BODYLOG_APP_ID, userIds);

  for (const entry of entries) {
    const profile = profilesById.get(entry.userId);
    if (profile) {
      entry.nickname = profile.nickname;
      entry.avatarKey = profile.avatarKey;
    }
  }

  // 计算统计数据
  const totalScore = entries.reduce((sum, e) => sum + e.score, 0);
  const avgScore = entries.length > 0 ? totalScore / entries.length : 0;
  const totalStreakDays = entries.reduce((sum, e) => sum + e.streakDays, 0);

  // 计算本周完成率（按已产生的记录天数计算，避免分母虚高）
  const recordedDays = new Set(dailyRecords.map((r) => r.date)).size;
  const totalPossibleCompletions = activeMembers.length * Math.min(recordedDays, 7);
  const actualCompletions = dailyRecords.reduce((sum, r) => sum + r.completedCount, 0);
  const weeklyCompletionRate = totalPossibleCompletions > 0
    ? Math.min(100, (actualCompletions / totalPossibleCompletions) * 100)
    : 0;

  return {
    groupId,
    groupName: group.name,
    entries,
    stats: {
      totalMembers: activeMembers.length,
      avgScore: Math.round(avgScore * 10) / 10,
      totalStreakDays,
      weeklyCompletionRate: Math.round(weeklyCompletionRate * 10) / 10,
    },
    currentUserId: userId,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 辅助方法：检查用户是否为Premium
 */
export async function checkIsPremium(subscriptionService: SubscriptionService | undefined, userId: string): Promise<boolean> {
  if (!subscriptionService) {
    return false;
  }

  try {
    const isPremium = await subscriptionService.isPremium(BODYLOG_APP_ID, userId);
    return isPremium;
  } catch (error) {
    console.error("Failed to check premium status:", error);
    return false;
  }
}

export type GroupLeaderboardResponse = Awaited<ReturnType<typeof getGroupLeaderboard>>;
