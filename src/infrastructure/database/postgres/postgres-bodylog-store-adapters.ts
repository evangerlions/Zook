import type { Pool } from "pg";
import type {
  BodyLogBuddyStore,
  BodyLogFeatureFlagStore,
  BodyLogGroupStore,
  BodyLogGrowthStore,
  BodyLogNotificationStore,
  BodyLogStores,
  BodyLogSubscriptionStore,
} from "../../bodylog-store-ports.ts";
import * as buddySql from "./postgres-bodylog-buddy.ts";
import * as groupSql from "./postgres-bodylog-group.ts";
import * as growthSql from "./postgres-bodylog-growth.ts";
import { PostgresBodyLogNotificationStore } from "./postgres-bodylog-notification.ts";
import { PostgresBodyLogFeatureFlagStore } from "./postgres-bodylog-feature-flags.ts";
import { PostgresSubscriptionStore } from "./postgres-subscription.ts";

type PostgresStoreQuery = (sql: string, values?: unknown[]) => Promise<{ rows: any[] }>;

const buddyStore = (pool: Pool): BodyLogBuddyStore => ({
  insertBodyLogBuddyPair: (record) => buddySql.insertBodyLogBuddyPair(pool, record),
  findBodyLogBuddyPair: (pairId) => buddySql.findBodyLogBuddyPair(pool, pairId),
  updateBodyLogBuddyPair: (record) => buddySql.updateBodyLogBuddyPair(pool, record),
  listBodyLogBuddyPairsByUser: (appId, userId) => buddySql.listBodyLogBuddyPairsByUser(pool, appId, userId),
  listAllBodyLogBuddyPairs: (appId) => buddySql.listAllBodyLogBuddyPairs(pool, appId),
  findBodyLogBuddyPairByUsers: (appId, userId, partnerUserId) => buddySql.findBodyLogBuddyPairByUsers(pool, appId, userId, partnerUserId),
  insertBodyLogBuddyActivity: (record) => buddySql.insertBodyLogBuddyActivity(pool, record),
  listBodyLogBuddyActivities: (pairId) => buddySql.listBodyLogBuddyActivities(pool, pairId),
  insertBodyLogBuddyEncouragement: (record) => buddySql.insertBodyLogBuddyEncouragement(pool, record),
  listBodyLogBuddyEncouragements: (pairId) => buddySql.listBodyLogBuddyEncouragements(pool, pairId),
});

const groupStore = (pool: Pool): BodyLogGroupStore => ({
  insertCheckInGroup: (record) => groupSql.insertCheckInGroup(pool, record),
  findCheckInGroup: (groupId) => groupSql.findCheckInGroup(pool, groupId),
  updateCheckInGroup: (record) => groupSql.updateCheckInGroup(pool, record),
  listCheckInGroupsByUser: (appId, userId) => groupSql.listCheckInGroupsByUser(pool, appId, userId),
  listAllCheckInGroups: (appId) => groupSql.listAllCheckInGroups(pool, appId),
  insertGroupMember: (record) => groupSql.insertGroupMember(pool, record),
  findGroupMember: (groupId, userId) => groupSql.findGroupMember(pool, groupId, userId),
  updateGroupMember: (record) => groupSql.updateGroupMember(pool, record),
  listGroupMembers: (groupId) => groupSql.listGroupMembers(pool, groupId),
  insertGroupDailyRecord: (record) => groupSql.insertGroupDailyRecord(pool, record),
  findGroupDailyRecord: (groupId, date) => groupSql.findGroupDailyRecord(pool, groupId, date),
  updateGroupDailyRecord: (record) => groupSql.updateGroupDailyRecord(pool, record),
  listGroupDailyRecordsSince: (groupId, date) => groupSql.listGroupDailyRecordsSince(pool, groupId, date),
  insertGroupActivity: (record) => groupSql.insertGroupActivity(pool, record),
  listGroupActivities: (groupId, limit) => groupSql.listGroupActivities(pool, groupId, limit),
});

const growthStore = (pool: Pool): BodyLogGrowthStore => ({
  createGrowthPlan: (input) => growthSql.createPostgresGrowthPlan(pool, input),
  findGrowthPlanById: (planId) => growthSql.findPostgresGrowthPlanById(pool, planId),
  findActiveGrowthPlan: (userId) => growthSql.findPostgresActiveGrowthPlan(pool, userId),
  updateGrowthPlan: (planId, input) => growthSql.updatePostgresGrowthPlan(pool, planId, input),
  incrementGrowthPlanCompletedMissions: (planId) => growthSql.incrementPostgresGrowthPlanCompletedMissions(pool, planId),
  createGrowthMission: (input) => growthSql.createPostgresGrowthMission(pool, input),
  findGrowthMissionById: (missionId) => growthSql.findPostgresGrowthMissionById(pool, missionId),
  findGrowthMissionsByPlanId: (planId) => growthSql.findPostgresGrowthMissionsByPlanId(pool, planId),
  updateGrowthMission: (missionId, input) => growthSql.updatePostgresGrowthMission(pool, missionId, input),
  completeGrowthMission: (missionId, completedAt) => growthSql.completePostgresGrowthMission(pool, missionId, completedAt),
  createGrowthReward: (input) => growthSql.createPostgresGrowthReward(pool, input),
  findGrowthRewardById: (rewardId) => growthSql.findPostgresGrowthRewardById(pool, rewardId),
  findGrowthRewardsByPlanId: (planId) => growthSql.findPostgresGrowthRewardsByPlanId(pool, planId),
  updateGrowthReward: (rewardId, input) => growthSql.updatePostgresGrowthReward(pool, rewardId, input),
  claimGrowthReward: (rewardId, claimedAt) => growthSql.claimPostgresGrowthReward(pool, rewardId, claimedAt),
});

const notificationStore = (store: PostgresBodyLogNotificationStore): BodyLogNotificationStore => ({
  findBodyLogNotificationPreferences: (userId) => store.findPreferences(userId),
  upsertBodyLogNotificationPreferences: (userId, input) => store.upsertPreferences(userId, input),
  upsertBodyLogPushDevice: (userId, deviceToken, platform, name) => store.upsertDevice(userId, deviceToken, platform, name),
  listBodyLogPushDevices: (userId) => store.listDevices(userId),
  findBodyLogPushDevice: (deviceId) => store.findDevice(deviceId),
  deleteBodyLogPushDevice: (deviceId) => store.deleteDevice(deviceId),
});

const featureFlagStore = (store: PostgresBodyLogFeatureFlagStore): BodyLogFeatureFlagStore => ({
  listBodyLogFeatureFlags: () => store.listFlags(),
  findBodyLogFeatureFlag: (key) => store.findFlag(key),
  updateBodyLogFeatureFlag: (key, enabled) => store.updateFlag(key, enabled),
});

/**
 * Wraps the functional postgres bodylog stores so PostgresDatabase only needs
 * one accessor line per domain. All stores use session-aware query closures
 * so multi-step service operations and settlement claims share a transaction.
 */
export function createBodyLogPostgresStores(
  query: PostgresStoreQuery,
  execute: <T>(operation: () => Promise<T>) => Promise<T>,
): BodyLogStores {
  // All SQL must follow the transaction's AsyncLocalStorage client, including
  // functional stores. Binding the raw pool would commit partial operations.
  const scopedPool = { query } as unknown as Pool;
  return {
    jobs: {
      runOnce: (key, job) => execute(async () => {
        const claimed = await query('INSERT INTO bodylog_settlement_jobs (key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING key', [key]);
        if (!claimed.rows.length) return false;
        await job();
        return true;
      }),
    },
    buddy: buddyStore(scopedPool),
    group: groupStore(scopedPool),
    subscription: new PostgresSubscriptionStore(query),
    growth: growthStore(scopedPool),
    notification: notificationStore(new PostgresBodyLogNotificationStore(query)),
    flags: featureFlagStore(new PostgresBodyLogFeatureFlagStore(query)),
  };
}
