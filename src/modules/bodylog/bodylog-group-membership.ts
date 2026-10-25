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
interface MembershipContext {
 store: BodyLogGroupStore; social: BodyLogSocialAccess;
 checkIsPremium(userId:string):Promise<boolean>;
 getGroupDetail(userId:string,groupId:string):Promise<CheckInGroupDetailResponse>;
 sendGroupNotification(userId:string,type:GroupNotificationType,groupId:string,actorUserId?:string,consecutiveDays?:number,tier?:string,invitationToken?:string):Promise<void>;
}
export class BodyLogGroupMembership {
 constructor(private readonly context:MembershipContext) {}
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
    const isPremium = await this.context.checkIsPremium(userId);
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

    const leaderProfile = await this.context.social.findBodyLogProfile(BODYLOG_APP_ID, userId);
    if (!leaderProfile) {
      throw new ApplicationError(404, "GROUP_LEADER_NOT_FOUND", "Group leader not found.");
    }
    await this.context.store.insertCheckInGroup(groupRecord);

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

    await this.context.store.insertGroupMember(leaderMember);

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
    const group = await this.context.store.findCheckInGroup(groupId);
    if (!group) {
      throw new ApplicationError(404, "GROUP_NOT_FOUND", "Group not found.");
    }

    // 验证用户是否是组长或管理员
    const member = await this.context.store.findGroupMember(groupId, userId);
    if (!member || member.status !== 'active' || (member.role !== "leader" && member.role !== "admin")) {
      throw new ApplicationError(403, "GROUP_NOT_AUTHORIZED", "Only leader or admin can invite members.");
    }

    // 检查小组状态
    if (group.status !== "active") {
      throw new ApplicationError(409, "GROUP_NOT_ACTIVE", "Group is not active.");
    }

    // 检查是否已满员
    const members = await this.context.store.listGroupMembers(groupId);
    const activeMembers = members.filter((m) => m.status === "active");
    if (activeMembers.length >= group.maxMembers) {
      throw new ApplicationError(403, "GROUP_FULL", "Group is full.");
    }

    // 检查被邀请者是否已在小组中
    const existingMember = await this.context.store.findGroupMember(groupId, inviteeUserId);
    if (existingMember && existingMember.status === "active") {
      throw new ApplicationError(409, "GROUP_ALREADY_MEMBER", "User is already a member.");
    }

    // 检查被邀请者的小组数量限制
    const inviteeGroups = await this.getMyGroups(inviteeUserId);
    const isPremium = await this.context.checkIsPremium(inviteeUserId);
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
      await this.context.store.updateGroupMember(updatedMember);
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
      await this.context.store.insertGroupMember(newMember);
    }

    // 发送邀请通知
    await this.context.sendGroupNotification(inviteeUserId, "group_invite", groupId, userId, undefined, undefined, invitationToken);

    return { invitationToken };
  }

  /**
   * 接受小组邀请
   */
  async acceptInvite(userId: string, groupId: string, token: string): Promise<CheckInGroup> {
    const group = await this.context.store.findCheckInGroup(groupId);
    if (!group) {
      throw new ApplicationError(404, "GROUP_NOT_FOUND", "Group not found.");
    }

    if (group.status !== 'active') {
      throw new ApplicationError(409, 'GROUP_NOT_ACTIVE', 'Group is not active.');
    }
    if (typeof token !== 'string' || !token) {
      throw new ApplicationError(403, 'GROUP_INVITE_INVALID', 'Invalid invitation token.');
    }
    let member = await this.context.store.findGroupMember(groupId, userId);
    if (member?.status === 'active') {
      throw new ApplicationError(409, 'GROUP_ALREADY_MEMBER', 'Already a group member.');
    }
    const isSharedLink = group.invitationToken === token;
    if (!member && isSharedLink) {
      if (!(await this.context.social.findBodyLogProfile(BODYLOG_APP_ID, userId))) {
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
    const members = await this.context.store.listGroupMembers(groupId);
    const activeMembers = members.filter((m) => m.status === "active");
    if (activeMembers.length >= group.maxMembers) {
      throw new ApplicationError(403, "GROUP_FULL", "Group is full.");
    }
    const limit = await this.context.checkIsPremium(userId) ? GROUP_LIMITS.PREMIUM : GROUP_LIMITS.FREE;
    if ((await this.getMyGroups(userId)).length >= limit) {
      throw new ApplicationError(403, 'GROUP_LIMIT_REACHED', 'Group limit reached.');
    }

    // 更新成员状态为active
    const updatedMember: GroupMemberRecord = {
      ...member,
      status: "active",
      invitationToken: null,
    };
    if (await this.context.store.findGroupMember(groupId, userId)) await this.context.store.updateGroupMember(updatedMember);
    else await this.context.store.insertGroupMember(updatedMember);

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
    await this.context.store.insertGroupActivity(activity);

    // 发送通知给组长
    await this.context.sendGroupNotification(group.leaderUserId, "group_accepted", groupId, userId);

    return (await this.context.getGroupDetail(userId, groupId)).group;
  }

  /**
   * 离开小组
   */
  async getMyGroups(userId: string): Promise<CheckInGroup[]> {
    const groups = await this.context.store.listCheckInGroupsByUser(BODYLOG_APP_ID, userId);
    const activeGroups = groups.filter(group => group.status === "active");
    
    if (activeGroups.length === 0) {
      return [];
    }

    // 批量查询所有群的成员
    const groupIds = activeGroups.map(g => g.id);
    const membersByGroup = await this.context.store.listGroupMembersByGroupIds(groupIds);

    // 批量查询所有群主的资料
    const leaderUserIds = [...new Set(activeGroups.map(g => g.leaderUserId))];
    const profilesById = await this.context.social.listBodyLogProfilesByIds(BODYLOG_APP_ID, leaderUserIds);

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
   * 获取小组详情
   */
}
