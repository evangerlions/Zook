import type { BodyLogAdminStore } from "../../infrastructure/bodylog-store-ports.ts";
import type { BodyLogFeatureFlagStore } from "../../infrastructure/bodylog-store-ports.ts";
import type {
  AdminChallengeDetails,
  AdminChallengeStatistics,
  AdminFeatureFlag,
  AdminFeatureFlagAnalytics,
  AdminGrowthPlanDetails,
  AdminGrowthStatistics,
  AdminNotificationConfig,
  AdminOperationsMetrics,
  AdminOperationsSummary,
  AdminReportListResult,
  AdminBlockListResult,
  AdminSeasonListResult,
  AdminSeasonRankingListResult,
  AdminChallengeListResult,
  AdminRewardListResult,
  AdminRewardStatistics,
  AdminGrowthPlanListResult,
  AdminScoringConfig,
  AdminSeasonConfig,
  AdminUserDetails,
  AdminUserListResult,
  AdminUserStatus,
  AdminPagination,
} from "./bodylog-admin.types.ts";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function resolvePagination(page?: number, pageSize?: number): { offset: number; limit: number; page: number; pageSize: number } {
  const p = Number.isSafeInteger(page) ? Math.max(1, page as number) : 1;
  const ps = Number.isSafeInteger(pageSize)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize as number))
    : DEFAULT_PAGE_SIZE;
  return { offset: (p - 1) * ps, limit: ps, page: p, pageSize: ps };
}

function buildPagination(page: number, pageSize: number, total: number): AdminPagination {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export class BodyLogAdminService {
  constructor(
    private readonly adminStore: BodyLogAdminStore,
    private readonly featureFlagStore: BodyLogFeatureFlagStore,
  ) {}

  // ===== Operations Dashboard =====

  async getOperationsSummary(appId: string): Promise<AdminOperationsSummary> {
    return await this.adminStore.getOperationsSummary(appId);
  }

  async getOperationsMetrics(appId: string, period: "7d" | "30d" | "90d"): Promise<AdminOperationsMetrics> {
    const periodDays = period === "7d" ? 7 : period === "30d" ? 30 : 90;
    return await this.adminStore.getOperationsMetrics(appId, periodDays);
  }

  // ===== User Management =====

  async listUsers(appId: string, page?: number, pageSize?: number, search?: string): Promise<AdminUserListResult> {
    const { offset, limit, page: p, pageSize: ps } = resolvePagination(page, pageSize);
    const { users, total } = await this.adminStore.listUserProfiles(appId, offset, limit, search);
    return { users, pagination: buildPagination(p, ps, total) };
  }

  // ===== Social Moderation =====

  async listReports(appId: string, page?: number, pageSize?: number): Promise<AdminReportListResult> {
    const { offset, limit, page: p, pageSize: ps } = resolvePagination(page, pageSize);
    const { reports, total } = await this.adminStore.listReportsPaginated(appId, offset, limit);
    return { reports, pagination: buildPagination(p, ps, total) };
  }

  async listBlocks(appId: string, page?: number, pageSize?: number): Promise<AdminBlockListResult> {
    const { offset, limit, page: p, pageSize: ps } = resolvePagination(page, pageSize);
    const { blocks, total } = await this.adminStore.listBlocksPaginated(appId, offset, limit);
    return { blocks, pagination: buildPagination(p, ps, total) };
  }

  async removeBlock(appId: string, blockerUserId: string, blockedUserId: string): Promise<void> {
    await this.adminStore.deleteBlock(appId, blockerUserId, blockedUserId);
  }

  // ===== Leaderboard Management =====

  async listSeasons(appId: string, page?: number, pageSize?: number): Promise<AdminSeasonListResult> {
    const { offset, limit, page: p, pageSize: ps } = resolvePagination(page, pageSize);
    const { seasons, total } = await this.adminStore.listSeasons(appId, offset, limit);
    return { seasons, pagination: buildPagination(p, ps, total) };
  }

  async listSeasonRankings(appId: string, seasonLabel: string, page?: number, pageSize?: number): Promise<AdminSeasonRankingListResult> {
    const { offset, limit, page: p, pageSize: ps } = resolvePagination(page, pageSize);
    const { rankings, total } = await this.adminStore.listSeasonRankings(appId, seasonLabel, offset, limit);
    return { seasonLabel, rankings, pagination: buildPagination(p, ps, total) };
  }

  async removeSeasonEntry(appId: string, seasonLabel: string, userId: string): Promise<void> {
    await this.adminStore.removeSeasonEntry(appId, seasonLabel, userId);
  }

  // ===== Challenge Management =====

  async listChallenges(appId: string, page?: number, pageSize?: number): Promise<AdminChallengeListResult> {
    const { offset, limit, page: p, pageSize: ps } = resolvePagination(page, pageSize);
    const { challenges, total } = await this.adminStore.listChallengesPaginated(appId, offset, limit);
    return { challenges, pagination: buildPagination(p, ps, total) };
  }

  async getChallengeStatistics(appId: string): Promise<AdminChallengeStatistics> {
    return await this.adminStore.getChallengeStatistics(appId);
  }

  // ===== Reward Management =====

  async listRewards(page?: number, pageSize?: number): Promise<AdminRewardListResult> {
    const { offset, limit, page: p, pageSize: ps } = resolvePagination(page, pageSize);
    const { rewards, total } = await this.adminStore.listRewardsPaginated(offset, limit);
    return { rewards, pagination: buildPagination(p, ps, total) };
  }

  async getRewardStatistics(): Promise<AdminRewardStatistics> {
    return await this.adminStore.getRewardStatistics();
  }

  // ===== Feature Flag Management =====

  async listFeatureFlags(): Promise<AdminFeatureFlag[]> {
    const flags = await this.featureFlagStore.listBodyLogFeatureFlags();
    return flags.map((f) => ({
      key: f.key,
      enabled: f.enabled,
      description: f.description,
      updatedAt: f.updatedAt,
    }));
  }

  async updateFeatureFlag(key: string, enabled: boolean): Promise<AdminFeatureFlag> {
    const flag = await this.featureFlagStore.updateBodyLogFeatureFlag(key, enabled);
    return { key: flag.key, enabled: flag.enabled, description: flag.description, updatedAt: flag.updatedAt };
  }

  async getFeatureFlagAnalytics(): Promise<AdminFeatureFlagAnalytics[]> {
    return await this.adminStore.getFeatureFlagAnalytics();
  }

  // ===== Growth Plan Management =====

  async listGrowthPlans(page?: number, pageSize?: number): Promise<AdminGrowthPlanListResult> {
    const { offset, limit, page: p, pageSize: ps } = resolvePagination(page, pageSize);
    const { plans, total } = await this.adminStore.listGrowthPlansPaginated(offset, limit);
    return { plans, pagination: buildPagination(p, ps, total) };
  }

  async getGrowthStatistics(): Promise<AdminGrowthStatistics> {
    return await this.adminStore.getGrowthStatistics();
  }

  // ===== User Details =====

  async getUserDetails(appId: string, userId: string): Promise<AdminUserDetails | null> {
    return await this.adminStore.getUserDetails(appId, userId);
  }

  async updateUserStatus(appId: string, userId: string, status: AdminUserStatus): Promise<void> {
    await this.adminStore.updateUserStatus(appId, userId, status);
  }

  async resetUserData(appId: string, userId: string): Promise<void> {
    await this.adminStore.resetUserData(appId, userId);
  }

  // ===== Report Resolution =====

  async resolveReport(reportId: string, resolvedBy: string, resolution: string): Promise<void> {
    await this.adminStore.resolveReport(reportId, resolvedBy, resolution);
  }

  // ===== Challenge Details =====

  async getChallengeDetails(appId: string, challengeId: string): Promise<AdminChallengeDetails | null> {
    return await this.adminStore.getChallengeDetails(appId, challengeId);
  }

  // ===== Growth Plan Details =====

  async getGrowthPlanDetails(planId: string): Promise<AdminGrowthPlanDetails | null> {
    return await this.adminStore.getGrowthPlanDetails(planId);
  }

  // ===== Manual Reward Issuance =====

  async manualIssueReward(input: { planId: string; userId: string; type: string; value: string }): Promise<import("./bodylog-admin.types.ts").AdminReward> {
    return await this.adminStore.manualIssueReward(input);
  }

  // ===== System Configuration =====

  async getNotificationConfig(): Promise<AdminNotificationConfig> {
    return await this.adminStore.getNotificationConfig();
  }

  async updateNotificationConfig(config: AdminNotificationConfig): Promise<void> {
    await this.adminStore.updateNotificationConfig(config);
  }

  async getScoringConfig(): Promise<AdminScoringConfig> {
    return await this.adminStore.getScoringConfig();
  }

  async updateScoringConfig(config: AdminScoringConfig): Promise<void> {
    await this.adminStore.updateScoringConfig(config);
  }

  async getSeasonConfig(): Promise<AdminSeasonConfig> {
    return await this.adminStore.getSeasonConfig();
  }

  async updateSeasonConfig(config: AdminSeasonConfig): Promise<void> {
    await this.adminStore.updateSeasonConfig(config);
  }
}
