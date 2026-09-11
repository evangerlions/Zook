import { randomBytes } from "node:crypto";
import type { BodyLogGroupStore, BodyLogSocialAccess } from "../../infrastructure/bodylog-store-ports.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";
import { BODYLOG_APP_ID } from "./bodylog-profile.types.ts";
import type {
  CheckInGroup,
  CheckInGroupRecord,
  GroupMemberRecord,
  GroupActivity,
  GroupActivityRecord,
  CreateCheckInGroupRequest,
  GroupCheckinRequest,
  CheckInGroupDetailResponse,
  GroupMember,
  GroupDailyRecord,
  GroupDailyRecordRecord,
} from "./bodylog-group.types.ts";
import {
  GROUP_LIMITS,
  GROUP_MEMBER_LIMITS,
  GROUP_INVITATION_EXPIRY_DAYS,
} from "./bodylog-group.types.ts";
import type { NotificationService } from "../../services/notification.service.ts";
import { buildGroupNotificationPayload, type GroupNotificationType } from "./bodylog-group-notification.ts";
import { SubscriptionService } from "../../services/subscription.service.ts";
import { BodyLogGroupSettlement } from "./bodylog-group-settlement.ts";
import { getBodyLogGroupDetail } from "./bodylog-group-detail.ts";

const DAY_MS = 86_400_000;

export class BodyLogGroupService {
  private readonly settlement: BodyLogGroupSettlement;

  constructor(
    private readonly store: BodyLogGroupStore,
    private readonly social: BodyLogSocialAccess,
    private readonly notificationService?: NotificationService,
    private readonly subscriptionService?: SubscriptionService,
  ) {
    this.settlement = new BodyLogGroupSettlement(store, notificationService, subscriptionService);
  }

  /**
   * 创建打卡小组
   */
  async createGroup(userId: string, req: CreateCheckInGroupRequest): Promise<{ group: CheckInGroup; invitationUrl: string }> {
    const { name, icon, sharedHabitIds, completionRule = "all", maxMembers = 3 } = req;

    // 验证参数
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new ApplicationError(400, "GROUP_INVALID_NAME", "Group name is required.");
    }
    if (name.length > 50) {
      throw new ApplicationError(400, "GROUP_NAME_TOO_LONG", "Group name must be 50 characters or less.");
    }
    if (!Array.isArray(sharedHabitIds) || sharedHabitIds.length === 0 || sharedHabitIds.some(id => typeof id !== 'string' || !id.trim()) || new Set(sharedHabitIds).size !== sharedHabitIds.length) {
      throw new ApplicationError(400, "GROUP_INVALID_HABITS", "Must select at least one shared habit.");
    }
    if (!Number.isInteger(maxMembers) || maxMembers < 2 || maxMembers > 5) {
      throw new ApplicationError(400, "GROUP_INVALID_MEMBERS", "Max members must be between 2 and 5.");
    }
    if (!["all", "majority"].includes(completionRule) || (icon !== undefined && typeof icon !== 'string')) {
      throw new ApplicationError(400, "REQ_INVALID_BODY", "Invalid completionRule or icon.");
    }

    // 检查用户是否已有足够的小组
    const myGroups = await this.getMyGroups(userId);
    const isPremium = await this.checkIsPremium(userId);
    const limit = isPremium ? GROUP_LIMITS.PREMIUM : GROUP_LIMITS.FREE;
    if (myGroups.length >= limit) {
      throw new ApplicationError(403, "GROUP_LIMIT_REACHED", `Group limit reached (${limit}).`);
    }

    // 检查成员上限
    const memberLimit = isPremium ? GROUP_MEMBER_LIMITS.PREMIUM : GROUP_MEMBER_LIMITS.FREE;
    const effectiveMaxMembers = Math.min(maxMembers, memberLimit);

    // 创建小组记录
    const now = new Date();
    const groupId = randomId("group");
    const invitationToken = randomBytes(24).toString("base64url");

    const groupRecord: CheckInGroupRecord = {
      invitationToken,
      id: groupId,
      appId: BODYLOG_APP_ID,
      name: name.trim(),
      icon: icon ?? null,
      leaderUserId: userId,
      sharedHabitIds,
      completionRule,
      maxMembers: effectiveMaxMembers,
      status: "active",
      consecutiveDays: 0,
      maxConsecutive: 0,
      currentTier: null,
      lastActiveDate: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    const leaderProfile = await this.social.findBodyLogProfile(BODYLOG_APP_ID, userId);
    if (!leaderProfile) {
      throw new ApplicationError(404, "GROUP_LEADER_NOT_FOUND", "Group leader not found.");
    }
    await this.store.insertCheckInGroup(groupRecord);

    // 创建者自动成为组长
    const leaderMember: GroupMemberRecord = {
      id: randomId("group_member"),
      groupId,
      userId,
      role: "leader",
      joinedAt: now.toISOString(),
      invitationToken: null,
      status: "active",
    };

    await this.store.insertGroupMember(leaderMember);

    // 获取创建者信息

    const group: CheckInGroup = {
      id: groupId,
      name: groupRecord.name,
      icon: groupRecord.icon,
      leaderUserId: userId,
      leaderNickname: leaderProfile.nickname,
      leaderAvatarKey: leaderProfile.avatarKey,
      sharedHabitIds,
      completionRule,
      maxMembers: effectiveMaxMembers,
      currentMembers: 1,
      status: "active",
      consecutiveDays: 0,
      maxConsecutive: 0,
      currentTier: null,
      lastActiveDate: null,
      createdAt: now.toISOString(),
    };

    const invitationUrl = `https://bodylog.app/g/${groupId}?token=${invitationToken}`;

    return { group, invitationUrl };
  }

  /**
   * 邀请成员加入小组
   */
  async inviteMember(userId: string, groupId: string, inviteeUserId: string): Promise<{ invitationToken: string }> {
    const group = await this.store.findCheckInGroup(groupId);
    if (!group) {
      throw new ApplicationError(404, "GROUP_NOT_FOUND", "Group not found.");
    }

    // 验证用户是否是组长或管理员
    const member = await this.store.findGroupMember(groupId, userId);
    if (!member || member.status !== 'active' || (member.role !== "leader" && member.role !== "admin")) {
      throw new ApplicationError(403, "GROUP_NOT_AUTHORIZED", "Only leader or admin can invite members.");
    }

    // 检查小组状态
    if (group.status !== "active") {
      throw new ApplicationError(409, "GROUP_NOT_ACTIVE", "Group is not active.");
    }

    // 检查是否已满员
    const members = await this.store.listGroupMembers(groupId);
    const activeMembers = members.filter((m) => m.status === "active");
    if (activeMembers.length >= group.maxMembers) {
      throw new ApplicationError(403, "GROUP_FULL", "Group is full.");
    }

    // 检查被邀请者是否已在小组中
    const existingMember = await this.store.findGroupMember(groupId, inviteeUserId);
    if (existingMember && existingMember.status === "active") {
      throw new ApplicationError(409, "GROUP_ALREADY_MEMBER", "User is already a member.");
    }

    // 检查被邀请者的小组数量限制
    const inviteeGroups = await this.getMyGroups(inviteeUserId);
    const isPremium = await this.checkIsPremium(inviteeUserId);
    const limit = isPremium ? GROUP_LIMITS.PREMIUM : GROUP_LIMITS.FREE;
    if (inviteeGroups.length >= limit) {
      throw new ApplicationError(403, "GROUP_LIMIT_REACHED", `Invitee group limit reached (${limit}).`);
    }

    // 创建邀请
    const now = new Date();
    const invitationToken = randomBytes(24).toString("base64url");

    if (existingMember) {
      // 更新已有的成员记录
      const updatedMember: GroupMemberRecord = {
        ...existingMember,
        status: "pending",
        invitationToken,
        joinedAt: now.toISOString(),
      };
      await this.store.updateGroupMember(updatedMember);
    } else {
      // 创建新的成员记录
      const newMember: GroupMemberRecord = {
        id: randomId("group_member"),
        groupId,
        userId: inviteeUserId,
        role: "member",
        joinedAt: now.toISOString(),
        invitationToken,
        status: "pending",
      };
      await this.store.insertGroupMember(newMember);
    }

    // 发送邀请通知
    await this.sendGroupNotification(inviteeUserId, "group_invite", groupId, userId, undefined, undefined, invitationToken);

    return { invitationToken };
  }

  /**
   * 接受小组邀请
   */
  async acceptInvite(userId: string, groupId: string, token: string): Promise<CheckInGroup> {
    const group = await this.store.findCheckInGroup(groupId);
    if (!group) {
      throw new ApplicationError(404, "GROUP_NOT_FOUND", "Group not found.");
    }

    if (group.status !== 'active') {
      throw new ApplicationError(409, 'GROUP_NOT_ACTIVE', 'Group is not active.');
    }
    if (typeof token !== 'string' || !token) {
      throw new ApplicationError(403, 'GROUP_INVITE_INVALID', 'Invalid invitation token.');
    }
    let member = await this.store.findGroupMember(groupId, userId);
    if (member?.status === 'active') {
      throw new ApplicationError(409, 'GROUP_ALREADY_MEMBER', 'Already a group member.');
    }
    const isSharedLink = group.invitationToken === token;
    if (!member && isSharedLink) {
      if (!(await this.social.findBodyLogProfile(BODYLOG_APP_ID, userId))) {
        throw new ApplicationError(403, 'GROUP_NOT_MEMBER', 'Create a BodyLog profile before joining.');
      }
      member = { id: randomId('group_member'), groupId, userId, role: 'member', joinedAt: group.createdAt, invitationToken: token, status: 'pending' };
    }
    if (!member) {
      throw new ApplicationError(404, "GROUP_INVITE_NOT_FOUND", "Invitation not found.");
    }

    // 验证邀请token
    if (member.status !== 'pending' || (!isSharedLink && member.invitationToken !== token)) {
      throw new ApplicationError(403, "GROUP_INVITE_INVALID", "Invalid invitation token.");
    }

    // 检查是否过期
    const joinedAt = new Date(isSharedLink ? group.createdAt : member.joinedAt);
    const now = new Date();
    const daysSinceInvited = (now.getTime() - joinedAt.getTime()) / DAY_MS;
    if (daysSinceInvited > GROUP_INVITATION_EXPIRY_DAYS) {
      throw new ApplicationError(410, "GROUP_INVITE_EXPIRED", "Invitation has expired.");
    }

    // 检查是否已满员
    const members = await this.store.listGroupMembers(groupId);
    const activeMembers = members.filter((m) => m.status === "active");
    if (activeMembers.length >= group.maxMembers) {
      throw new ApplicationError(403, "GROUP_FULL", "Group is full.");
    }
    const limit = await this.checkIsPremium(userId) ? GROUP_LIMITS.PREMIUM : GROUP_LIMITS.FREE;
    if ((await this.getMyGroups(userId)).length >= limit) {
      throw new ApplicationError(403, 'GROUP_LIMIT_REACHED', 'Group limit reached.');
    }

    // 更新成员状态为active
    const updatedMember: GroupMemberRecord = {
      ...member,
      status: "active",
      invitationToken: null,
    };
    if (await this.store.findGroupMember(groupId, userId)) await this.store.updateGroupMember(updatedMember);
    else await this.store.insertGroupMember(updatedMember);

    // 创建活动记录
    const activity: GroupActivityRecord = {
      id: randomId("group_activity"),
      groupId,
      actorUserId: userId,
      type: "joined",
      targetHabitId: null,
      payload: {},
      createdAt: now.toISOString(),
    };
    await this.store.insertGroupActivity(activity);

    // 发送通知给组长
    await this.sendGroupNotification(group.leaderUserId, "group_accepted", groupId, userId);

    return (await this.getGroupDetail(userId, groupId)).group;
  }

  /**
   * 离开小组
   */
  async leaveGroup(userId: string, groupId: string): Promise<void> {
    const group = await this.store.findCheckInGroup(groupId);
    if (!group) {
      throw new ApplicationError(404, "GROUP_NOT_FOUND", "Group not found.");
    }

    const member = await this.store.findGroupMember(groupId, userId);
    if (!member || member.status !== "active") {
      throw new ApplicationError(404, "GROUP_NOT_MEMBER", "Not a member of this group.");
    }

    // 如果是组长，需要转让组长或解散小组
    if (member.role === "leader") {
      const members = await this.store.listGroupMembers(groupId);
      const otherActiveMembers = members.filter((m) => m.userId !== userId && m.status === "active");

      if (otherActiveMembers.length === 0) {
        // 没有其他成员，解散小组
        const updatedGroup: CheckInGroupRecord = {
          ...group,
          status: "archived",
          updatedAt: new Date().toISOString(),
        };
        await this.store.updateCheckInGroup(updatedGroup);
      } else {
        // 转让组长给第一个活跃成员
        const newLeader = otherActiveMembers[0];
        const updatedLeader: GroupMemberRecord = {
          ...newLeader,
          role: "leader",
        };
        await this.store.updateGroupMember(updatedLeader);

        const updatedGroup: CheckInGroupRecord = {
          ...group,
          leaderUserId: newLeader.userId,
          updatedAt: new Date().toISOString(),
        };
        await this.store.updateCheckInGroup(updatedGroup);
      }
    }

    // 更新成员状态为left
    const updatedMember: GroupMemberRecord = {
      ...member,
      status: "left",
    };
    await this.store.updateGroupMember(updatedMember);

    // 创建活动记录
    const activity: GroupActivityRecord = {
      id: randomId("group_activity"),
      groupId,
      actorUserId: userId,
      type: "left",
      targetHabitId: null,
      payload: {},
      createdAt: new Date().toISOString(),
    };
    await this.store.insertGroupActivity(activity);
  }

  /**
   * 获取用户的小组列表
   */
  async getMyGroups(userId: string): Promise<CheckInGroup[]> {
    const groups = await this.store.listCheckInGroupsByUser(BODYLOG_APP_ID, userId);
    const result: CheckInGroup[] = [];

    for (const group of groups) {
      if (group.status !== "active") continue;

      const members = await this.store.listGroupMembers(group.id);
      const activeMembers = members.filter((m) => m.status === "active");
      const leaderProfile = await this.social.findBodyLogProfile(BODYLOG_APP_ID, group.leaderUserId);
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
   * 获取小组详情
   */
  async getGroupDetail(userId: string, groupId: string): Promise<CheckInGroupDetailResponse> {
    return getBodyLogGroupDetail(this.store, this.social, userId, groupId);
  }
  /**
   * 记录小组打卡
   */
  async recordGroupCheckin(userId: string, groupId: string, req: GroupCheckinRequest): Promise<void> {
    const group = await this.store.findCheckInGroup(groupId);
    if (!group) {
      throw new ApplicationError(404, "GROUP_NOT_FOUND", "Group not found.");
    }

    const member = await this.store.findGroupMember(groupId, userId);
    if (!member || member.status !== "active") {
      throw new ApplicationError(403, "GROUP_NOT_MEMBER", "Not a member of this group.");
    }

    if (group.status !== "active") {
      throw new ApplicationError(409, "GROUP_NOT_ACTIVE", "Group is not active.");
    }
    if (!group.sharedHabitIds.includes(req.habitId) || !Number.isInteger(req.count ?? 1) || (req.count ?? 1) < 1) {
      throw new ApplicationError(400, "GROUP_INVALID_HABITS", "Check-in requires a shared habit and a positive integer count.");
    }

    const now = new Date();
    const today = now.toISOString().split("T")[0];

    // 创建活动记录
    const activity: GroupActivityRecord = {
      id: randomId("group_activity"),
      groupId,
      actorUserId: userId,
      type: "checked_in",
      targetHabitId: req.habitId,
      payload: { count: req.count ?? 1, date: today },
      createdAt: now.toISOString(),
    };
    await this.store.insertGroupActivity(activity);

    // 更新每日记录
    await this.updateDailyRecord(groupId, userId, today);

    // 发送打卡通知给其他成员
    const members = await this.store.listGroupMembers(groupId);
    const otherMembers = members.filter((m) => m.userId !== userId && m.status === "active");
    for (const member of otherMembers) {
      await this.sendGroupNotification(member.userId, "group_checked_in", groupId, userId, req.habitId);
    }

    // 更新小组最后活跃日期
    const updatedGroup: CheckInGroupRecord = {
      ...group,
      lastActiveDate: today,
      updatedAt: now.toISOString(),
    };
    await this.store.updateCheckInGroup(updatedGroup);
  }

  /**
   * 每日结算 - 计算小组连续天数
   */
  async dailySettlement(): Promise<void> {
    await this.settlement.dailySettlement();
  }

  /**
   * 每周结算 - 生成周报和排名
   */
  async weeklySettlement(): Promise<void> {
    await this.settlement.weeklySettlement();
  }

  /**
   * 更新每日记录
   */
  private async updateDailyRecord(groupId: string, userId: string, date: string): Promise<void> {
    const existingRecord = await this.store.findGroupDailyRecord(groupId, date);

    const members = await this.store.listGroupMembers(groupId);
    const activeMembers = members.filter((m) => m.status === "active");

    if (existingRecord) {
      // 更新现有记录
      const activeIds = new Set(activeMembers.map(member => member.userId));
      const completedUserIds = [...new Set([...existingRecord.completedUserIds, userId])].filter(id => activeIds.has(id));

      const updatedRecord: GroupDailyRecordRecord = {
        ...existingRecord,
        totalMembers: activeMembers.length,
        completedUserIds,
        completedCount: completedUserIds.length,
        completionRate: (completedUserIds.length / activeMembers.length) * 100,
      };
      await this.store.updateGroupDailyRecord(updatedRecord);
    } else {
      // 创建新记录
      const newRecord: GroupDailyRecordRecord = {
        id: randomId("group_daily_record"),
        groupId,
        date,
        completedUserIds: [userId],
        totalMembers: activeMembers.length,
        completedCount: 1,
        completionRate: (1 / activeMembers.length) * 100,
        createdAt: new Date().toISOString(),
      };
      await this.store.insertGroupDailyRecord(newRecord);
    }
  }

  /**
   * 辅助方法：检查用户是否为Premium
   */
  private async checkIsPremium(userId: string): Promise<boolean> {
    if (!this.subscriptionService) {
      return false;
    }

    try {
      const isPremium = await this.subscriptionService.isPremium(BODYLOG_APP_ID, userId);
      return isPremium;
    } catch (error) {
      console.error("Failed to check premium status:", error);
      return false;
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
    invitationToken?: string,
  ): Promise<void> {
    if (!this.notificationService) return;

    const payload = buildGroupNotificationPayload({
      type,
      groupId,
      userId,
      habitId,
      tier,
      data: invitationToken ? { invitation_url: `https://bodylog.app/g/${groupId}?token=${invitationToken}` } : undefined,
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
