import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { BodyLogAdminService } from "../../src/modules/bodylog/bodylog-admin.service.ts";
import type { BodyLogAdminStore, BodyLogFeatureFlagStore } from "../../src/infrastructure/bodylog-store-ports.ts";
import type {
  AdminOperationsSummary,
  AdminUserDetails,
  AdminChallengeDetails,
  AdminGrowthPlanDetails,
  AdminNotificationConfig,
  AdminScoringConfig,
  AdminSeasonConfig,
} from "../../src/modules/bodylog/bodylog-admin.types.ts";

describe("BodyLogAdminService", () => {
  let service: BodyLogAdminService;
  let mockAdminStore: BodyLogAdminStore;
  let mockFeatureFlagStore: BodyLogFeatureFlagStore;

  const mockOperationsSummary: AdminOperationsSummary = {
    overview: {
      totalUsers: 100,
      totalBuddyPairs: 50,
      totalGroups: 20,
      totalChallenges: 30,
      activeGrowthPlans: 15,
    },
    subscriptions: {
      totalActive: 25,
      byTier: { free: 75, premium: 20, vip: 5 },
    },
    generatedAt: "2026-10-07T00:00:00.000Z",
  };

  const mockUserDetails: AdminUserDetails = {
    userId: "user-1",
    nickname: "Test User",
    avatarKey: null,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActiveAt: "2026-10-07T00:00:00.000Z",
    subscriptionTier: "premium",
    friendCount: 10,
    buddyPairCount: 2,
    groupCount: 3,
    email: "test@example.com",
    subscription: {
      tier: "premium",
      expiresAt: "2027-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
    },
    social: {
      friendsCount: 10,
      buddyPairsCount: 2,
      groupsCount: 3,
      friendRequestsPending: 1,
    },
    growth: {
      activePlan: {
        planId: "plan-1",
        startDate: "2026-10-01T00:00:00.000Z",
        completedMissions: 5,
        totalMissions: 21,
      },
    },
    reports: {
      reportsMade: 2,
      reportsReceived: 0,
    },
  };

  beforeEach(() => {
    mockAdminStore = {
      getOperationsSummary: mock.fn(async () => mockOperationsSummary),
      getOperationsMetrics: mock.fn(async (_appId, periodDays) => ({
        period: periodDays === 7 ? "7d" : periodDays === 30 ? "30d" : "90d",
        newUsers: 10,
        activeUsers: 50,
        buddyCheckins: 100,
        groupCheckins: 50,
        challengesCompleted: 20,
        growthMissionsCompleted: 80,
        newSubscriptions: 5,
      })),
      listUserProfiles: mock.fn(async () => ({ users: [], total: 0 })),
      getUserDetails: mock.fn(async () => mockUserDetails),
      updateUserStatus: mock.fn(async () => {}),
      resetUserData: mock.fn(async () => {}),
      listReportsPaginated: mock.fn(async () => ({ reports: [], total: 0 })),
      resolveReport: mock.fn(async () => {}),
      listBlocksPaginated: mock.fn(async () => ({ blocks: [], total: 0 })),
      deleteBlock: mock.fn(async () => {}),
      listSeasons: mock.fn(async () => ({ seasons: [], total: 0 })),
      listSeasonRankings: mock.fn(async () => ({ rankings: [], total: 0 })),
      removeSeasonEntry: mock.fn(async () => {}),
      listChallengesPaginated: mock.fn(async () => ({ challenges: [], total: 0 })),
      getChallengeDetails: mock.fn(async () => null),
      getChallengeStatistics: mock.fn(async () => ({
        totalChallenges: 30,
        activeChallenges: 10,
        completedChallenges: 20,
        avgMembersPerChallenge: 5,
      })),
      listGrowthPlansPaginated: mock.fn(async () => ({ plans: [], total: 0 })),
      getGrowthPlanDetails: mock.fn(async () => null),
      getGrowthStatistics: mock.fn(async () => ({
        totalPlans: 100,
        activePlans: 15,
        completedPlans: 85,
        avgCompletionRate: 0.85,
      })),
      listRewardsPaginated: mock.fn(async () => ({ rewards: [], total: 0 })),
      manualIssueReward: mock.fn(async (input) => ({
        rewardId: "reward-1",
        planId: input.planId,
        userId: input.userId,
        type: input.type,
        value: input.value,
        claimed: false,
        claimedAt: null,
        createdAt: "2026-10-07T00:00:00.000Z",
      })),
      getRewardStatistics: mock.fn(async () => ({
        totalRewards: 200,
        claimedRewards: 150,
        claimRate: 0.75,
      })),
      getFeatureFlagAnalytics: mock.fn(async () => []),
      getNotificationConfig: mock.fn(async () => ({
        pushDeliveryEnabled: true,
        defaultQuietHours: { isEnabled: false, startHour: 22, endHour: 8 },
      })),
      updateNotificationConfig: mock.fn(async () => {}),
      getScoringConfig: mock.fn(async () => ({
        buddyCheckinBaseScore: 10,
        buddyEncouragementScore: 2,
        groupCheckinBaseScore: 15,
        challengeCompletionBonus: 50,
        growthMissionScore: 5,
      })),
      updateScoringConfig: mock.fn(async () => {}),
      getSeasonConfig: mock.fn(async () => ({
        defaultDurationDays: 7,
        maxParticipantsPerSeason: 1000,
        allowAnonymousLeaderboard: false,
        autoCloseSeasons: true,
      })),
      updateSeasonConfig: mock.fn(async () => {}),
    } as unknown as BodyLogAdminStore;

    mockFeatureFlagStore = {
      listBodyLogFeatureFlags: mock.fn(async () => []),
      updateBodyLogFeatureFlag: mock.fn(async (key, enabled) => ({
        key,
        enabled,
        description: null,
        updatedAt: "2026-10-07T00:00:00.000Z",
      })),
    } as unknown as BodyLogFeatureFlagStore;

    service = new BodyLogAdminService(mockAdminStore, mockFeatureFlagStore);
  });

  describe("Operations Dashboard", () => {
    it("should return operations summary", async () => {
      const result = await service.getOperationsSummary("bodylog");

      assert.equal(result.overview.totalUsers, 100);
      assert.equal(result.overview.totalBuddyPairs, 50);
      assert.equal(result.subscriptions.totalActive, 25);

      const getSummaryMock = mockAdminStore.getOperationsSummary as ReturnType<typeof mock.fn>;
      assert.equal(getSummaryMock.mock.callCount(), 1);
    });

    it("should return operations metrics for 7d period", async () => {
      const result = await service.getOperationsMetrics("bodylog", "7d");

      assert.equal(result.period, "7d");
      assert.equal(result.newUsers, 10);
      assert.equal(result.activeUsers, 50);
    });

    it("should return operations metrics for 30d period", async () => {
      const result = await service.getOperationsMetrics("bodylog", "30d");

      assert.equal(result.period, "30d");
    });

    it("should return operations metrics for 90d period", async () => {
      const result = await service.getOperationsMetrics("bodylog", "90d");

      assert.equal(result.period, "90d");
    });
  });

  describe("User Management", () => {
    it("should list users with pagination", async () => {
      const result = await service.listUsers("bodylog", 1, 20, "test");

      assert.ok(result.users);
      assert.ok(result.pagination);
      assert.equal(result.pagination.page, 1);
      assert.equal(result.pagination.pageSize, 20);
    });

    it("should fall back to safe defaults for invalid pagination values", async () => {
      const result = await service.listUsers("bodylog", Number.NaN, Number.NaN);

      assert.equal(result.pagination.page, 1);
      assert.equal(result.pagination.pageSize, 20);
    });

    it("should return user details", async () => {
      const result = await service.getUserDetails("bodylog", "user-1");

      assert.equal(result?.userId, "user-1");
      assert.equal(result?.nickname, "Test User");
      assert.equal(result?.status, "active");
      assert.equal(result?.subscriptionTier, "premium");
    });

    it("should update user status", async () => {
      await service.updateUserStatus("bodylog", "user-1", "banned");

      const updateMock = mockAdminStore.updateUserStatus as ReturnType<typeof mock.fn>;
      assert.equal(updateMock.mock.callCount(), 1);
      assert.equal(updateMock.mock.calls[0].arguments[2], "banned");
    });

    it("should reset user data", async () => {
      await service.resetUserData("bodylog", "user-1");

      const resetMock = mockAdminStore.resetUserData as ReturnType<typeof mock.fn>;
      assert.equal(resetMock.mock.callCount(), 1);
    });
  });

  describe("Social Moderation", () => {
    it("should list reports with pagination", async () => {
      const result = await service.listReports("bodylog", 1, 20);

      assert.ok(result.reports);
      assert.ok(result.pagination);
    });

    it("should resolve report", async () => {
      await service.resolveReport("report-1", "admin-user", "warned");

      const resolveMock = mockAdminStore.resolveReport as ReturnType<typeof mock.fn>;
      assert.equal(resolveMock.mock.callCount(), 1);
      assert.equal(resolveMock.mock.calls[0].arguments[0], "report-1");
      assert.equal(resolveMock.mock.calls[0].arguments[1], "admin-user");
      assert.equal(resolveMock.mock.calls[0].arguments[2], "warned");
    });

    it("should list blocks with pagination", async () => {
      const result = await service.listBlocks("bodylog", 1, 20);

      assert.ok(result.blocks);
      assert.ok(result.pagination);
    });

    it("should remove block", async () => {
      await service.removeBlock("bodylog", "user-a", "user-b");

      const deleteMock = mockAdminStore.deleteBlock as ReturnType<typeof mock.fn>;
      assert.equal(deleteMock.mock.callCount(), 1);
    });
  });

  describe("Leaderboard Management", () => {
    it("should list seasons with pagination", async () => {
      const result = await service.listSeasons("bodylog", 1, 20);

      assert.ok(result.seasons);
      assert.ok(result.pagination);
    });

    it("should list season rankings", async () => {
      const result = await service.listSeasonRankings("bodylog", "2026-W40", 1, 20);

      assert.ok(result.rankings);
      assert.equal(result.seasonLabel, "2026-W40");
    });

    it("should remove season entry", async () => {
      await service.removeSeasonEntry("bodylog", "2026-W40", "user-1");

      const removeMock = mockAdminStore.removeSeasonEntry as ReturnType<typeof mock.fn>;
      assert.equal(removeMock.mock.callCount(), 1);
    });

  });

  describe("Challenge Management", () => {
    it("should list challenges with pagination", async () => {
      const result = await service.listChallenges("bodylog", 1, 20);

      assert.ok(result.challenges);
      assert.ok(result.pagination);
    });

    it("should return challenge statistics", async () => {
      const result = await service.getChallengeStatistics("bodylog");

      assert.equal(result.totalChallenges, 30);
      assert.equal(result.activeChallenges, 10);
      assert.equal(result.completedChallenges, 20);
    });
  });

  describe("Reward Management", () => {
    it("should list rewards with pagination", async () => {
      const result = await service.listRewards(1, 20);

      assert.ok(result.rewards);
      assert.ok(result.pagination);
    });

    it("should return reward statistics", async () => {
      const result = await service.getRewardStatistics();

      assert.equal(result.totalRewards, 200);
      assert.equal(result.claimedRewards, 150);
      assert.equal(result.claimRate, 0.75);
    });

    it("should manually issue reward", async () => {
      const result = await service.manualIssueReward({
        planId: "plan-1",
        userId: "user-1",
        type: "badge",
        value: "special_award",
      });

      assert.equal(result.planId, "plan-1");
      assert.equal(result.userId, "user-1");
      assert.equal(result.type, "badge");
      assert.equal(result.value, "special_award");
      assert.equal(result.claimed, false);

      const issueMock = mockAdminStore.manualIssueReward as ReturnType<typeof mock.fn>;
      assert.equal(issueMock.mock.callCount(), 1);
    });
  });

  describe("Feature Flag Management", () => {
    it("should list feature flags", async () => {
      const result = await service.listFeatureFlags();

      assert.ok(Array.isArray(result));
    });

    it("should update feature flag", async () => {
      const result = await service.updateFeatureFlag("growth", true);

      assert.equal(result.key, "growth");
      assert.equal(result.enabled, true);

      const updateMock = mockFeatureFlagStore.updateBodyLogFeatureFlag as ReturnType<typeof mock.fn>;
      assert.equal(updateMock.mock.callCount(), 1);
    });

    it("should return feature flag analytics", async () => {
      const result = await service.getFeatureFlagAnalytics();

      assert.ok(Array.isArray(result));
    });
  });

  describe("Growth Plan Management", () => {
    it("should list growth plans with pagination", async () => {
      const result = await service.listGrowthPlans(1, 20);

      assert.ok(result.plans);
      assert.ok(result.pagination);
    });

    it("should return growth statistics", async () => {
      const result = await service.getGrowthStatistics();

      assert.equal(result.totalPlans, 100);
      assert.equal(result.activePlans, 15);
      assert.equal(result.completedPlans, 85);
      assert.equal(result.avgCompletionRate, 0.85);
    });
  });

  describe("System Configuration", () => {
    it("should return notification config", async () => {
      const result = await service.getNotificationConfig();

      assert.equal(result.pushDeliveryEnabled, true);
      assert.equal(result.defaultQuietHours.isEnabled, false);
      assert.equal(result.defaultQuietHours.startHour, 22);
      assert.equal(result.defaultQuietHours.endHour, 8);
    });

    it("should update notification config", async () => {
      const config: AdminNotificationConfig = {
        pushDeliveryEnabled: false,
        defaultQuietHours: { isEnabled: true, startHour: 23, endHour: 7 },
      };

      await service.updateNotificationConfig(config);

      const updateMock = mockAdminStore.updateNotificationConfig as ReturnType<typeof mock.fn>;
      assert.equal(updateMock.mock.callCount(), 1);
    });

    it("should return scoring config", async () => {
      const result = await service.getScoringConfig();

      assert.equal(result.buddyCheckinBaseScore, 10);
      assert.equal(result.buddyEncouragementScore, 2);
      assert.equal(result.groupCheckinBaseScore, 15);
      assert.equal(result.challengeCompletionBonus, 50);
      assert.equal(result.growthMissionScore, 5);
    });

    it("should update scoring config", async () => {
      const config: AdminScoringConfig = {
        buddyCheckinBaseScore: 12,
        buddyEncouragementScore: 3,
        groupCheckinBaseScore: 18,
        challengeCompletionBonus: 60,
        growthMissionScore: 6,
      };

      await service.updateScoringConfig(config);

      const updateMock = mockAdminStore.updateScoringConfig as ReturnType<typeof mock.fn>;
      assert.equal(updateMock.mock.callCount(), 1);
    });

    it("should return season config", async () => {
      const result = await service.getSeasonConfig();

      assert.equal(result.defaultDurationDays, 7);
      assert.equal(result.maxParticipantsPerSeason, 1000);
      assert.equal(result.allowAnonymousLeaderboard, false);
      assert.equal(result.autoCloseSeasons, true);
    });

    it("should update season config", async () => {
      const config: AdminSeasonConfig = {
        defaultDurationDays: 14,
        maxParticipantsPerSeason: 2000,
        allowAnonymousLeaderboard: true,
        autoCloseSeasons: false,
      };

      await service.updateSeasonConfig(config);

      const updateMock = mockAdminStore.updateSeasonConfig as ReturnType<typeof mock.fn>;
      assert.equal(updateMock.mock.callCount(), 1);
    });
  });
});
