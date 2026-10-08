import type { BodyLogAvatarKey } from "./bodylog-profile.types.ts";
import type { BuddyPairStatus, BuddyTier } from "./bodylog-buddy.types.ts";
import type { GrowthPlanStatus } from "./bodylog-growth.types.ts";
import type { SubscriptionTier } from "./bodylog-subscription.types.ts";
import type { BodyLogReportReason } from "./bodylog-social.types.ts";

// ===== Admin User Management =====

export type AdminUserStatus = "active" | "banned" | "suspended";

export interface AdminUserProfile {
  userId: string;
  nickname: string;
  avatarKey: BodyLogAvatarKey | null;
  status: AdminUserStatus;
  createdAt: string;
  lastActiveAt: string | null;
  subscriptionTier: SubscriptionTier;
  friendCount: number;
  buddyPairCount: number;
  groupCount: number;
}

export interface AdminUserDetails extends AdminUserProfile {
  email: string | null;
  subscription: {
    tier: SubscriptionTier;
    expiresAt: string | null;
    startedAt: string;
  } | null;
  social: {
    friendsCount: number;
    buddyPairsCount: number;
    groupsCount: number;
    friendRequestsPending: number;
  };
  growth: {
    activePlan: {
      planId: string;
      startDate: string;
      completedMissions: number;
      totalMissions: number;
    } | null;
  };
  reports: {
    reportsMade: number;
    reportsReceived: number;
  };
}

export interface AdminUserListResult {
  users: AdminUserProfile[];
  pagination: AdminPagination;
}

// ===== Admin Social Moderation =====

export type AdminReportStatus = "pending" | "resolved" | "dismissed";
export type AdminReportAction = "dismiss" | "warn" | "suspend" | "ban";

export interface AdminReport {
  reportId: string;
  reporterUserId: string;
  reporterNickname: string;
  reportedUserId: string;
  reportedNickname: string;
  reason: BodyLogReportReason;
  status: AdminReportStatus;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string | null;
}

export interface AdminReportListResult {
  reports: AdminReport[];
  pagination: AdminPagination;
}

export interface AdminBlock {
  blockerUserId: string;
  blockerNickname: string;
  blockedUserId: string;
  blockedNickname: string;
  createdAt: string;
}

export interface AdminBlockListResult {
  blocks: AdminBlock[];
  pagination: AdminPagination;
}

// ===== Admin Leaderboard Management =====

export interface AdminSeason {
  seasonLabel: string;
  startDate: string;
  endDate: string;
  participantCount: number;
  status: "active" | "completed" | "upcoming";
}

export interface AdminSeasonListResult {
  seasons: AdminSeason[];
  pagination: AdminPagination;
}

export interface AdminSeasonRanking {
  rank: number;
  userId: string;
  nickname: string;
  avatarKey: BodyLogAvatarKey | null;
  score: number;
  completedDays: number;
  joinedAt: string;
}

export interface AdminSeasonRankingListResult {
  seasonLabel: string;
  rankings: AdminSeasonRanking[];
  pagination: AdminPagination;
}

// ===== Admin Challenge Management =====

export interface AdminChallenge {
  challengeId: string;
  creatorUserId: string;
  creatorNickname: string;
  themeKey: string;
  status: string;
  memberCount: number;
  createdAt: string;
}

export interface AdminChallengeListResult {
  challenges: AdminChallenge[];
  pagination: AdminPagination;
}

export interface AdminChallengeDetails extends AdminChallenge {
  members: Array<{
    userId: string;
    nickname: string;
    status: string;
    completedDates: string[];
    joinedAt: string;
  }>;
}

export interface AdminChallengeStatistics {
  totalChallenges: number;
  activeChallenges: number;
  completedChallenges: number;
  avgMembersPerChallenge: number;
}

// ===== Admin Reward Management =====

export interface AdminReward {
  rewardId: string;
  planId: string;
  userId: string;
  type: string;
  value: string;
  claimed: boolean;
  claimedAt: string | null;
  createdAt: string;
}

export interface AdminRewardListResult {
  rewards: AdminReward[];
  pagination: AdminPagination;
}

export interface AdminRewardStatistics {
  totalRewards: number;
  claimedRewards: number;
  claimRate: number;
}

// ===== Admin Feature Flag Management =====

export interface AdminFeatureFlag {
  key: string;
  enabled: boolean;
  description: string | null;
  updatedAt: string;
}

export interface AdminFeatureFlagAnalytics {
  key: string;
  affectedUsers: number;
  activeUsage: number;
}

// ===== Admin Growth Plan Management =====

export interface AdminGrowthPlan {
  planId: string;
  userId: string;
  nickname: string;
  status: GrowthPlanStatus;
  startDate: string;
  endDate: string;
  completedMissions: number;
  totalMissions: number;
}

export interface AdminGrowthPlanListResult {
  plans: AdminGrowthPlan[];
  pagination: AdminPagination;
}

export interface AdminGrowthPlanDetails extends AdminGrowthPlan {
  missions: Array<{
    missionId: string;
    day: number;
    type: string;
    target: number;
    completed: boolean;
    completedAt: string | null;
  }>;
  rewards: Array<{
    rewardId: string;
    type: string;
    value: string;
    claimed: boolean;
    claimedAt: string | null;
  }>;
}

export interface AdminGrowthStatistics {
  totalPlans: number;
  activePlans: number;
  completedPlans: number;
  avgCompletionRate: number;
}

// ===== Admin Operations Dashboard =====

export interface AdminOperationsSummary {
  overview: {
    totalUsers: number;
    totalBuddyPairs: number;
    totalGroups: number;
    totalChallenges: number;
    activeGrowthPlans: number;
  };
  subscriptions: {
    totalActive: number;
    byTier: Record<string, number>;
  };
  generatedAt: string;
}

export interface AdminOperationsMetrics {
  period: "7d" | "30d" | "90d";
  newUsers: number;
  activeUsers: number;
  buddyCheckins: number;
  groupCheckins: number;
  challengesCompleted: number;
  growthMissionsCompleted: number;
  newSubscriptions: number;
}

// ===== Admin Pagination =====

export interface AdminPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// ===== Admin System Configuration =====

export interface AdminNotificationConfig {
  pushDeliveryEnabled: boolean;
  defaultQuietHours: {
    isEnabled: boolean;
    startHour: number;
    endHour: number;
  };
}

export interface AdminScoringConfig {
  buddyCheckinBaseScore: number;
  buddyEncouragementScore: number;
  groupCheckinBaseScore: number;
  challengeCompletionBonus: number;
  growthMissionScore: number;
}

export interface AdminSeasonConfig {
  defaultDurationDays: number;
  maxParticipantsPerSeason: number;
  allowAnonymousLeaderboard: boolean;
  autoCloseSeasons: boolean;
}
export interface BodyLogHabitTemplateRecord {
  id: string;
  appId: string;
  templateKey: string;
  category: string;
  names: Record<string, string>;
  icon: string | null;
  defaultTargetCount: number;
  sortOrder: number;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface BodyLogCheckinRecordRow {
  recordId: string;
  date: string;
  groupId: string;
  groupName: string;
  userId: string;
  completedCount: number;
  totalMembers: number;
  completionRate: number;
  createdAt: string;
}

export interface BodyLogGroupHealthRow {
  groupId: string;
  name: string;
  status: string;
  memberCount: number;
  leaderUserId: string;
  createdAt: string;
  lastActiveDate: string;
  checkins7d: number;
  checkins30d: number;
  activeMembers7d: number;
  completionRate7d: number;
}

export interface BodyLogGroupMemberContributionRow {
  userId: string;
  nickname: string;
  avatarKey: string | null;
  role: string;
  status: string;
  checkinCount: number;
  lastCheckinAt: string;
}

export interface BodyLogHabitUsageRow {
  habitId: string;
  checkins: number;
  lastCheckinAt: string;
}

export interface BodyLogCheckinDashboardAggregate {
  summary: {
    dau: number;
    checkins_today: number;
    active_groups: number;
    total_groups: number;
    total_members: number;
    checkin_rate_daily: number;
    checkin_rate_weekly: number;
    checkin_rate_monthly: number;
  };
  trend: Array<{
    date: string;
    dau: number;
    checkins: number;
    completion_rate: number;
  }>;
  consecutive_distribution: Array<{
    bucket: string;
    users: number;
  }>;
  habit_distribution: Array<{
    habit_id: string;
    checkins: number;
    share: number;
  }>;
}
