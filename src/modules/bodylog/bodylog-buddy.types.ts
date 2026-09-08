import type { BodyLogAvatarKey } from "./bodylog-profile.types.ts";

// ===== 搭子配对相关类型 =====

export type BuddyPairStatus = "pending" | "active" | "dissolved";
export type BuddyTier = "copper" | "silver" | "gold" | "diamond" | "legend";
export type BuddyInvitedVia = "friend" | "link" | "matching";

// 数据库记录类型
export interface BuddyPairRecord {
  inviterUserId?: string | null;
  id: string;
  appId: string;
  userId: string;
  partnerUserId: string;
  sharedHabitIds: string[];
  status: BuddyPairStatus;
  consecutiveDays: number;
  maxConsecutive: number;
  currentTier: BuddyTier | null;
  lastActiveDate: string | null;
  revivalUsedThisMonth: number;
  invitedVia: BuddyInvitedVia | null;
  invitationToken: string | null;
  createdAt: string;
  acceptedAt: string | null;
  dissolvedAt: string | null;
  updatedAt: string;
}

// API 返回类型
export interface BuddyPair {
  id: string;
  partnerUserId: string;
  partnerNickname: string;
  partnerAvatarKey: BodyLogAvatarKey;
  sharedHabitIds: string[];
  status: BuddyPairStatus;
  consecutiveDays: number;
  maxConsecutive: number;
  currentTier: BuddyTier | null;
  lastActiveDate: string | null;
  createdAt: string;
  acceptedAt: string | null;
}

// ===== 搭子活动相关类型 =====

export type BuddyActivityType =
  | "checked_in"
  | "encouraged"
  | "viewed"
  | "reminded"
  | "milestone"
  | "revived";

// 数据库记录类型
export interface BuddyActivityRecord {
  id: string;
  pairId: string;
  actorUserId: string;
  type: BuddyActivityType;
  targetHabitId: string | null;
  payload: Record<string, any>;
  createdAt: string;
}

// API 返回类型
export interface BuddyActivity {
  id: string;
  pairId: string;
  actorUserId: string;
  actorNickname: string;
  actorAvatarKey: BodyLogAvatarKey;
  type: BuddyActivityType;
  targetHabitId: string | null;
  targetHabitName?: string;
  payload: Record<string, any>;
  createdAt: string;
}

// ===== 搭子鼓励相关类型 =====

export type BuddyEncouragementEmoji = "💪" | "👏" | "🔥" | "😊";

// 数据库记录类型
export interface BuddyEncouragementRecord {
  id: string;
  pairId: string;
  fromUserId: string;
  toUserId: string;
  emoji: BuddyEncouragementEmoji;
  isSameAction: boolean;
  createdAt: string;
}

// API 返回类型
export interface BuddyEncouragement {
  id: string;
  pairId: string;
  fromUserId: string;
  fromNickname: string;
  toUserId: string;
  emoji: BuddyEncouragementEmoji;
  isSameAction: boolean;
  createdAt: string;
}

// ===== API 请求类型 =====

export interface CreateBuddyPairRequest {
  partnerUserId: string;
  sharedHabitIds: string[];
}

export interface AcceptBuddyPairRequest {
  pairId: string;
}

export interface DissolveBuddyPairRequest {
  pairId: string;
}

export interface EncourageBuddyRequest {
  pairId: string;
  emoji: BuddyEncouragementEmoji;
  isSameAction: boolean;
  targetHabitId?: string;
}

export interface ReviveBuddyStreakRequest {
  pairId: string;
}

// ===== API 响应类型 =====

export interface BuddyFeedResponse {
  pair: BuddyPair;
  activities: BuddyActivity[];
  encouragements: BuddyEncouragement[];
}

export interface BuddyListResponse {
  buddies: BuddyPair[];
  total: number;
}

export interface CreateBuddyPairResponse {
  pair: BuddyPair;
  invitationUrl: string;
}

// ===== 常量和配置 =====

export const BUDDY_PAIR_LIMITS = {
  FREE: 2,
  PREMIUM: 5,
} as const;

export const BUDDY_TIER_THRESHOLDS: Record<BuddyTier, number> = {
  copper: 3,
  silver: 7,
  gold: 30,
  diamond: 60,
  legend: 180,
} as const;

export const BUDDY_TIER_REWARDS: Record<BuddyTier, number> = {
  copper: 0,
  silver: 0,
  gold: 1, // 1 day Premium
  diamond: 3, // 3 days Premium
  legend: 7, // 7 days Premium
} as const;

export const BUDDY_INACTIVITY_THRESHOLDS = {
  WARNING_DAYS: 7,
  AUTO_DISSOLVE_DAYS: 14,
} as const;

export const BUDDY_REVIVAL_WINDOW_HOURS = 48;
export const BUDDY_RE_INVITATION_COOLDOWN_DAYS = 30;
