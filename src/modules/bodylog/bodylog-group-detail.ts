import type { BodyLogGroupStore, BodyLogSocialAccess } from "../../infrastructure/bodylog-store-ports.ts";
import type { CheckInGroup, CheckInGroupDetailResponse, GroupMember, GroupActivity, GroupDailyRecord } from "./bodylog-group.types.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { BODYLOG_APP_ID } from "./bodylog-profile.types.ts";
const DAY_MS = 86_400_000;

export async function getBodyLogGroupDetail(store: BodyLogGroupStore, social: BodyLogSocialAccess, userId: string, groupId: string): Promise<CheckInGroupDetailResponse> {
    const group = await store.findCheckInGroup(groupId);
    if (!group) {
      throw new ApplicationError(404, "GROUP_NOT_FOUND", "Group not found.");
    }

    // 验证用户是否是成员
    const member = await store.findGroupMember(groupId, userId);
    if (!member || member.status !== "active") {
      throw new ApplicationError(403, "GROUP_NOT_MEMBER", "Not a member of this group.");
    }

    const members = await store.listGroupMembers(groupId);
    const activeMembers = members.filter((m) => m.status === "active");
    const leaderProfile = await social.findBodyLogProfile(BODYLOG_APP_ID, group.leaderUserId);
    if (!leaderProfile) {
      throw new ApplicationError(404, "GROUP_LEADER_NOT_FOUND", "Group leader not found.");
    }

    const memberDocuments: GroupMember[] = [];
    for (const item of members) {
      const profile = await social.findBodyLogProfile(BODYLOG_APP_ID, item.userId);
      memberDocuments.push({
        userId: item.userId,
        nickname: profile?.nickname ?? "Unknown",
        avatarKey: profile?.avatarKey ?? "mint_runner",
        role: item.role,
        status: item.status,
        joinedAt: item.joinedAt,
      });
    }

    const recentActivities: GroupActivity[] = [];
    for (const item of await store.listGroupActivities(groupId, 50)) {
      const profile = await social.findBodyLogProfile(BODYLOG_APP_ID, item.actorUserId);
      recentActivities.push({
        ...item,
        actorNickname: profile?.nickname ?? "Unknown",
        actorAvatarKey: profile?.avatarKey ?? "mint_runner",
      });
    }

    const weeklyRecords: GroupDailyRecord[] = (await store.listGroupDailyRecordsSince(
      groupId,
      new Date(Date.now() - 7 * DAY_MS).toISOString().split("T")[0],
    )).map(({ date, completedUserIds, totalMembers, completedCount, completionRate }) => ({
      date,
      completedUserIds,
      totalMembers,
      completedCount,
      completionRate,
    }));

    const groupDocument: CheckInGroup = {
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
    };

    return { group: groupDocument, members: memberDocuments, recentActivities, weeklyRecords };
}
