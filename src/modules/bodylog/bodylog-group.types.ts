import type { BodyLogAvatarKey } from "./bodylog-profile.types.ts";

// ===== 打卡小组相关类型 =====

export type CheckInGroupStatus = "active" | "inactive" | "archived";
export type CheckInGroupTier = "bronze" | "silver" | "gold" | "platinum" | "diamond";
export type CompletionRule = "all" | "majority";
export type GroupMemberRole = "leader" | "admin" | "member";
export type GroupMemberStatus = "pending" | "active" | "left" | "removed";

// 数据库记录类型
export interface CheckInGroupRecord {
  invitationToken?: string | null;
  id: string;
  appId: string;
  name: string;
  icon: string | null;
  leaderUserId: string;
  sharedHabitIds: string[];
  completionRule: CompletionRule;
  maxMembers: number;
  status: CheckInGroupStatus;
  consecutiveDays: number;
  maxConsecutive: number;
  currentTier: CheckInGroupTier | null;
  lastActiveDate: string | null;
  createdAt: string;
  updatedAt: string;
}

// API 返回类型
export interface CheckInGroup {
  id: string;
  name: string;
  icon: string | null;
  leaderUserId: string;
  leaderNickname: string;
  leaderAvatarKey: BodyLogAvatarKey;
  sharedHabitIds: string[];
  completionRule: CompletionRule;
  maxMembers: number;
  currentMembers: number;
  status: CheckInGroupStatus;
  consecutiveDays: number;
  maxConsecutive: number;
  currentTier: CheckInGroupTier | null;
  lastActiveDate: string | null;
  createdAt: string;
}

// ===== 小组成员相关类型 =====

// 数据库记录类型
export interface GroupMemberRecord {
  id: string;
  groupId: string;
  userId: string;
  role: GroupMemberRole;
  joinedAt: string;
  invitationToken: string | null;
  status: GroupMemberStatus;
}

// API 返回类型
export interface GroupMember {
  userId: string;
  nickname: string;
  avatarKey: BodyLogAvatarKey;
  role: GroupMemberRole;
  status: GroupMemberStatus;
  joinedAt: string;
}

// ===== 小组每日记录相关类型 =====

// 数据库记录类型
export interface GroupDailyRecordRecord {
  id: string;
  groupId: string;
  date: string;
  completedUserIds: string[];
  totalMembers: number;
  completedCount: number;
  completionRate: number;
  createdAt: string;
}

// API 返回类型
export interface GroupDailyRecord {
  date: string;
  completedUserIds: string[];
  totalMembers: number;
  completedCount: number;
  completionRate: number;
}

// ===== 小组活动记录相关类型 =====

export type GroupActivityType = "joined" | "left" | "checked_in" | "encouraged" | "milestone";

// 数据库记录类型
export interface GroupActivityRecord {
  id: string;
  groupId: string;
  actorUserId: string;
  type: GroupActivityType;
  targetHabitId: string | null;
  payload: Record<string, any>;
  createdAt: string;
}

// API 返回类型
export interface GroupActivity {
  id: string;
  groupId: string;
  actorUserId: string;
  actorNickname: string;
  actorAvatarKey: BodyLogAvatarKey;
  type: GroupActivityType;
  targetHabitId: string | null;
  targetHabitName?: string;
  payload: Record<string, any>;
  createdAt: string;
}

// ===== API 请求类型 =====

export interface CreateCheckInGroupRequest {
  name: string;
  icon?: string;
  sharedHabitIds: string[];
  completionRule?: CompletionRule;
  maxMembers?: number;
}

export interface UpdateCheckInGroupRequest {
  name?: string;
  icon?: string;
  sharedHabitIds?: string[];
  completionRule?: CompletionRule;
}

export interface InviteGroupMemberRequest {
  userId: string;
}

export interface AcceptGroupInviteRequest {
  groupId: string;
  token: string;
}

export interface LeaveGroupRequest {
  groupId: string;
}

export interface GroupCheckinRequest {
  habitId: string;
  count?: number;
}

// ===== API 响应类型 =====

export interface CheckInGroupListResponse {
  groups: CheckInGroup[];
  total: number;
}

export interface CheckInGroupDetailResponse {
  group: CheckInGroup;
  members: GroupMember[];
  recentActivities: GroupActivity[];
  weeklyRecords: GroupDailyRecord[];
}

export interface CreateCheckInGroupResponse {
  group: CheckInGroup;
  invitationUrl: string;
}

// ===== 常量和配置 =====

export const GROUP_LIMITS = {
  FREE: 2, // 免费用户最多加入2个小组
  PREMIUM: 5, // Premium用户最多加入5个小组
} as const;

export const GROUP_MEMBER_LIMITS = {
  FREE: 3, // 免费用户创建的小组最多3人
  PREMIUM: 5, // Premium用户创建的小组最多5人
} as const;

export const GROUP_TIER_THRESHOLDS: Record<CheckInGroupTier, number> = {
  bronze: 3, // 3天
  silver: 7, // 7天
  gold: 30, // 30天
  platinum: 60, // 60天
  diamond: 180, // 180天
} as const;

export const GROUP_TIER_REWARDS: Record<CheckInGroupTier, number> = {
  bronze: 0,
  silver: 0,
  gold: 2, // 2天Premium
  platinum: 5, // 5天Premium
  diamond: 10, // 10天Premium
} as const;

export const GROUP_INVITATION_EXPIRY_DAYS = 7;
