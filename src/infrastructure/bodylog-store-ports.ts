import type { BodyLogProfileRecord } from "../modules/bodylog/bodylog-profile.types.ts";
import type { BodyLogBlockRecord } from "../modules/bodylog/bodylog-social.types.ts";
import type {
  BuddyPairRecord,
  BuddyActivityRecord,
  BuddyEncouragementRecord,
} from "../modules/bodylog/bodylog-buddy.types.ts";
import type {
  CheckInGroupRecord,
  GroupMemberRecord,
  GroupDailyRecordRecord,
  GroupActivityRecord,
} from "../modules/bodylog/bodylog-group.types.ts";
import type {
  UserSubscriptionRecord,
  SubscriptionEventRecord,
} from "../modules/bodylog/bodylog-subscription.types.ts";
import type {
  BodyLogGrowthPlan,
  BodyLogGrowthMission,
  BodyLogGrowthReward,
  CreateGrowthPlanInput,
  CreateGrowthMissionInput,
  CreateGrowthRewardInput,
  UpdateGrowthMissionInput,
  UpdateGrowthPlanInput,
  UpdateGrowthRewardInput,
} from "../modules/bodylog/bodylog-growth.types.ts";
import type {
  NotificationPreferencesRecord,
  UpdateNotificationPreferencesInput,
  PushDeviceRecord,
} from "../modules/bodylog/bodylog-notification.types.ts";
import type {
  AdminBlock,
  AdminChallenge,
  AdminChallengeStatistics,
  AdminFeatureFlagAnalytics,
  AdminGrowthPlan,
  AdminGrowthStatistics,
  AdminOperationsMetrics,
  AdminOperationsSummary,
  AdminReport,
  AdminReward,
  AdminRewardStatistics,
  AdminSeason,
  AdminSeasonRanking,
  AdminUserProfile,
} from "../modules/bodylog/bodylog-admin.types.ts";
import type { FeatureFlagRecord } from "../modules/bodylog/bodylog-feature-flag.types.ts";

type MaybePromise<T> = T | Promise<T>;

/**
 * Narrow store ports for the BodyLog buddy/group/growth/notification/
 * feature-flag/subscription domains. Module services depend only on these
 * interfaces; PostgresDatabase exposes them via accessors and test doubles
 * provide in-memory implementations.
 */
export interface BodyLogBuddyStore {
  insertBodyLogBuddyPair(record: BuddyPairRecord): MaybePromise<void>;
  findBodyLogBuddyPair(pairId: string): MaybePromise<BuddyPairRecord | undefined>;
  updateBodyLogBuddyPair(record: BuddyPairRecord): MaybePromise<void>;
  listBodyLogBuddyPairsByUser(appId: string, userId: string): MaybePromise<BuddyPairRecord[]>;
  listAllBodyLogBuddyPairs(appId: string): MaybePromise<BuddyPairRecord[]>;
  findBodyLogBuddyPairByUsers(appId: string, userId: string, partnerUserId: string): MaybePromise<BuddyPairRecord | undefined>;
  insertBodyLogBuddyActivity(record: BuddyActivityRecord): MaybePromise<void>;
  listBodyLogBuddyActivities(pairId: string): MaybePromise<BuddyActivityRecord[]>;
  insertBodyLogBuddyEncouragement(record: BuddyEncouragementRecord): MaybePromise<void>;
  listBodyLogBuddyEncouragements(pairId: string): MaybePromise<BuddyEncouragementRecord[]>;
}

export interface BodyLogGroupStore {
  insertCheckInGroup(record: CheckInGroupRecord): MaybePromise<void>;
  findCheckInGroup(groupId: string): MaybePromise<CheckInGroupRecord | undefined>;
  updateCheckInGroup(record: CheckInGroupRecord): MaybePromise<void>;
  listCheckInGroupsByUser(appId: string, userId: string): MaybePromise<CheckInGroupRecord[]>;
  listAllCheckInGroups(appId: string): MaybePromise<CheckInGroupRecord[]>;
  insertGroupMember(record: GroupMemberRecord): MaybePromise<void>;
  findGroupMember(groupId: string, userId: string): MaybePromise<GroupMemberRecord | undefined>;
  updateGroupMember(record: GroupMemberRecord): MaybePromise<void>;
  listGroupMembers(groupId: string): MaybePromise<GroupMemberRecord[]>;
  insertGroupDailyRecord(record: GroupDailyRecordRecord): MaybePromise<void>;
  findGroupDailyRecord(groupId: string, date: string): MaybePromise<GroupDailyRecordRecord | undefined>;
  updateGroupDailyRecord(record: GroupDailyRecordRecord): MaybePromise<void>;
  listGroupDailyRecordsSince(groupId: string, date: string): MaybePromise<GroupDailyRecordRecord[]>;
  insertGroupActivity(record: GroupActivityRecord): MaybePromise<void>;
  listGroupActivities(groupId: string, limit?: number): MaybePromise<GroupActivityRecord[]>;
}

export interface BodyLogSubscriptionStore {
  findActiveUserSubscription(appId: string, userId: string): MaybePromise<UserSubscriptionRecord | null>;
  upsertUserSubscription(record: UserSubscriptionRecord): MaybePromise<void>;
  insertSubscriptionEvent(record: SubscriptionEventRecord): MaybePromise<void>;
}

export interface BodyLogGrowthStore {
  createGrowthPlan(input: CreateGrowthPlanInput): MaybePromise<BodyLogGrowthPlan>;
  findGrowthPlanById(planId: string): MaybePromise<BodyLogGrowthPlan | null>;
  findLatestGrowthPlan(userId: string): MaybePromise<BodyLogGrowthPlan | null>;
  findActiveGrowthPlan(userId: string): MaybePromise<BodyLogGrowthPlan | null>;
  updateGrowthPlan(planId: string, input: UpdateGrowthPlanInput): MaybePromise<BodyLogGrowthPlan>;
  incrementGrowthPlanCompletedMissions(planId: string): MaybePromise<void>;
  createGrowthMission(input: CreateGrowthMissionInput): MaybePromise<BodyLogGrowthMission>;
  findGrowthMissionById(missionId: string): MaybePromise<BodyLogGrowthMission | null>;
  findGrowthMissionsByPlanId(planId: string): MaybePromise<BodyLogGrowthMission[]>;
  updateGrowthMission(missionId: string, input: UpdateGrowthMissionInput): MaybePromise<BodyLogGrowthMission>;
  completeGrowthMission?: (missionId: string, completedAt: string) => MaybePromise<BodyLogGrowthMission | null>;
  createGrowthReward(input: CreateGrowthRewardInput): MaybePromise<BodyLogGrowthReward>;
  findGrowthRewardById(rewardId: string): MaybePromise<BodyLogGrowthReward | null>;
  findGrowthRewardsByPlanId(planId: string): MaybePromise<BodyLogGrowthReward[]>;
  updateGrowthReward(rewardId: string, input: UpdateGrowthRewardInput): MaybePromise<BodyLogGrowthReward>;
  claimGrowthReward?: (rewardId: string, claimedAt: string) => MaybePromise<BodyLogGrowthReward | null>;
}

export interface BodyLogNotificationStore {
  findBodyLogNotificationPreferences(userId: string): MaybePromise<NotificationPreferencesRecord | null>;
  upsertBodyLogNotificationPreferences(
    userId: string,
    input: UpdateNotificationPreferencesInput,
  ): MaybePromise<NotificationPreferencesRecord>;
  upsertBodyLogPushDevice(
    userId: string,
    deviceToken: string,
    platform: "ios" | "android",
    name: string,
  ): MaybePromise<PushDeviceRecord>;
  listBodyLogPushDevices(userId: string): MaybePromise<PushDeviceRecord[]>;
  findBodyLogPushDevice(deviceId: string): MaybePromise<PushDeviceRecord | null>;
  deleteBodyLogPushDevice(deviceId: string): MaybePromise<void>;
}

export interface BodyLogFeatureFlagStore {
  listBodyLogFeatureFlags(): MaybePromise<FeatureFlagRecord[]>;
  findBodyLogFeatureFlag(key: string): MaybePromise<FeatureFlagRecord | null>;
  updateBodyLogFeatureFlag(key: string, enabled: boolean): MaybePromise<FeatureFlagRecord>;
}

/** Social lookups still owned by ApplicationDatabase, needed by buddy/group services. */
export interface BodyLogSocialAccess {
  findBodyLogProfile(appId: string, userId: string): MaybePromise<BodyLogProfileRecord | undefined>;
  listBodyLogBlocks(appId: string): MaybePromise<BodyLogBlockRecord[]>;
}

/**
 * Admin-specific aggregate queries for the BodyLog operations dashboard.
 * These cross-cutting queries don't belong to any single domain store.
 */
export interface BodyLogAdminStore {
  getOperationsSummary(appId: string): MaybePromise<AdminOperationsSummary>;
  getOperationsMetrics(appId: string, periodDays: number): MaybePromise<AdminOperationsMetrics>;
  listUserProfiles(appId: string, offset: number, limit: number, search?: string): MaybePromise<{ users: AdminUserProfile[]; total: number }>;
  listReportsPaginated(appId: string, offset: number, limit: number): MaybePromise<{ reports: AdminReport[]; total: number }>;
  listBlocksPaginated(appId: string, offset: number, limit: number): MaybePromise<{ blocks: AdminBlock[]; total: number }>;
  deleteBlock(appId: string, blockerUserId: string, blockedUserId: string): MaybePromise<void>;
  listSeasons(offset: number, limit: number): MaybePromise<{ seasons: AdminSeason[]; total: number }>;
  listSeasonRankings(appId: string, seasonLabel: string, offset: number, limit: number): MaybePromise<{ rankings: AdminSeasonRanking[]; total: number }>;
  removeSeasonEntry(appId: string, seasonLabel: string, userId: string): MaybePromise<void>;
  listChallengesPaginated(appId: string, offset: number, limit: number): MaybePromise<{ challenges: AdminChallenge[]; total: number }>;
  getChallengeStatistics(appId: string): MaybePromise<AdminChallengeStatistics>;
  listGrowthPlansPaginated(offset: number, limit: number): MaybePromise<{ plans: AdminGrowthPlan[]; total: number }>;
  getGrowthStatistics(): MaybePromise<AdminGrowthStatistics>;
  listRewardsPaginated(offset: number, limit: number): MaybePromise<{ rewards: AdminReward[]; total: number }>;
  getRewardStatistics(): MaybePromise<AdminRewardStatistics>;
  getFeatureFlagAnalytics(): MaybePromise<AdminFeatureFlagAnalytics[]>;
}

export interface BodyLogStores {
  jobs: { runOnce(key: string, job: () => Promise<void>): Promise<boolean> };
  buddy: BodyLogBuddyStore;
  group: BodyLogGroupStore;
  subscription: BodyLogSubscriptionStore;
  growth: BodyLogGrowthStore;
  notification: BodyLogNotificationStore;
  flags: BodyLogFeatureFlagStore;
  admin: BodyLogAdminStore;
}
