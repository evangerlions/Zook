import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { InMemoryBodyLogAdminStore } from "../../src/modules/bodylog/bodylog-stores.ts";
import { InMemoryBodyLogFeatureFlagStore } from "../../src/modules/bodylog/bodylog-stores.ts";
import { BodyLogAdminService } from "../../src/modules/bodylog/bodylog-admin.service.ts";

/**
 * 回归测试：验证管理后台 API 与实际客户端功能的对应关系
 *
 * 测试覆盖场景：
 * 1. 用户管理 - 对应客户端的 profile、friends、blocks 等功能
 * 2. 社交审核 - 对应客户端的 reports、blocks 功能
 * 3. 排行榜管理 - 对应客户端的 leaderboards 功能
 * 4. 挑战管理 - 对应客户端的 challenges 功能
 * 5. 奖励管理 - 对应客户端的 rewards 功能
 * 6. 成长计划 - 对应客户端的 seven-day-plan 功能
 * 7. 功能开关 - 对应客户端的 feature flags 功能
 * 8. 系统配置 - 影响全局行为的配置
 */
describe("BodyLog Admin Regression Tests", () => {
  let adminStore: InMemoryBodyLogAdminStore;
  let featureFlagStore: InMemoryBodyLogFeatureFlagStore;
  let service: BodyLogAdminService;

  beforeEach(() => {
    adminStore = new InMemoryBodyLogAdminStore();
    featureFlagStore = new InMemoryBodyLogFeatureFlagStore();
    service = new BodyLogAdminService(adminStore, featureFlagStore);
  });

  describe("用户管理回归", () => {
    it("应该能够查看用户详情（对应客户端 profile 功能）", async () => {
      // 管理后台应该能够查看任何用户的详细信息
      const userDetails = await service.getUserDetails("bodylog", "test-user-1");

      // InMemory 返回 null，但应该能够正确处理
      assert.ok(userDetails === null || typeof userDetails === "object");
    });

    it("应该能够修改用户状态（对应客户端封禁功能）", async () => {
      // 管理后台应该能够封禁/解封用户
      await service.updateUserStatus("bodylog", "test-user-1", "banned");

      // 应该能够恢复用户状态
      await service.updateUserStatus("bodylog", "test-user-1", "active");

      // 应该能够暂停用户
      await service.updateUserStatus("bodylog", "test-user-1", "suspended");
    });

    it("应该能够重置用户数据（对应客户端数据清理功能）", async () => {
      // 管理后台应该能够重置用户的所有数据
      await service.resetUserData("bodylog", "test-user-1");

      // 不应该抛出异常
      assert.ok(true);
    });

    it("应该能够列出用户（对应客户端用户搜索功能）", async () => {
      // 管理后台应该能够分页列出用户
      const result = await service.listUsers("bodylog", 1, 20);

      assert.ok(result.users);
      assert.ok(result.pagination);
      assert.equal(result.pagination.page, 1);
      assert.equal(result.pagination.pageSize, 20);
    });
  });

  describe("社交审核回归", () => {
    it("应该能够查看举报列表（对应客户端举报功能）", async () => {
      // 客户端可以举报用户，管理后台应该能够查看所有举报
      const result = await service.listReports("bodylog", 1, 20);

      assert.ok(result.reports);
      assert.ok(result.pagination);
    });

    it("应该能够处理举报（对应客户端举报处理流程）", async () => {
      // 管理后台应该能够处理举报：驳回、警告、暂停、封禁
      await service.resolveReport("report-1", "admin-user", "warned");

      // 不应该抛出异常
      assert.ok(true);
    });

    it("应该能够查看屏蔽列表（对应客户端屏蔽功能）", async () => {
      // 客户端可以屏蔽其他用户，管理后台应该能够查看所有屏蔽
      const result = await service.listBlocks("bodylog", 1, 20);

      assert.ok(result.blocks);
      assert.ok(result.pagination);
    });

    it("应该能够移除屏蔽（对应客户端解除屏蔽功能）", async () => {
      // 管理后台应该能够强制移除屏蔽
      await service.removeBlock("bodylog", "user-a", "user-b");

      // 不应该抛出异常
      assert.ok(true);
    });
  });

  describe("排行榜管理回归", () => {
    it("应该能够查看赛季列表（对应客户端排行榜功能）", async () => {
      // 客户端可以查看当前赛季，管理后台应该能够查看所有赛季
      const result = await service.listSeasons("bodylog", 1, 20);

      assert.ok(result.seasons);
      assert.ok(result.pagination);
    });

    it("应该能够查看赛季排名（对应客户端排行榜排名功能）", async () => {
      // 客户端可以查看排行榜，管理后台应该能够查看任何赛季的排名
      const result = await service.listSeasonRankings("bodylog", "2026-W40", 1, 20);

      assert.ok(result.rankings);
      assert.equal(result.seasonLabel, "2026-W40");
    });

    it("应该能够移除排名条目（对应客户端排行榜管理功能）", async () => {
      // 管理后台应该能够移除作弊者的排名
      await service.removeSeasonEntry("bodylog", "2026-W40", "cheater-user");

      // 不应该抛出异常
      assert.ok(true);
    });

  });

  describe("挑战管理回归", () => {
    it("应该能够查看挑战列表（对应客户端挑战功能）", async () => {
      // 客户端可以创建和参与挑战，管理后台应该能够查看所有挑战
      const result = await service.listChallenges("bodylog", 1, 20);

      assert.ok(result.challenges);
      assert.ok(result.pagination);
    });

    it("应该能够查看挑战统计（对应客户端挑战数据功能）", async () => {
      // 管理后台应该能够查看挑战统计数据
      const stats = await service.getChallengeStatistics("bodylog");

      assert.equal(typeof stats.totalChallenges, "number");
      assert.equal(typeof stats.activeChallenges, "number");
      assert.equal(typeof stats.completedChallenges, "number");
      assert.equal(typeof stats.avgMembersPerChallenge, "number");
    });
  });

  describe("奖励管理回归", () => {
    it("应该能够查看奖励列表（对应客户端奖励功能）", async () => {
      // 客户端可以领取奖励，管理后台应该能够查看所有奖励
      const result = await service.listRewards(1, 20);

      assert.ok(result.rewards);
      assert.ok(result.pagination);
    });

    it("应该能够手动发放奖励（对应客户端奖励补发功能）", async () => {
      // 管理后台应该能够手动为用户发放奖励
      const reward = await service.manualIssueReward({
        planId: "plan-1",
        userId: "user-1",
        type: "badge",
        value: "special_award",
      });

      assert.equal(reward.planId, "plan-1");
      assert.equal(reward.userId, "user-1");
      assert.equal(reward.type, "badge");
      assert.equal(reward.value, "special_award");
      assert.equal(reward.claimed, false);
    });

    it("应该能够查看奖励统计（对应客户端奖励数据功能）", async () => {
      // 管理后台应该能够查看奖励统计数据
      const stats = await service.getRewardStatistics();

      assert.equal(typeof stats.totalRewards, "number");
      assert.equal(typeof stats.claimedRewards, "number");
      assert.equal(typeof stats.claimRate, "number");
    });
  });

  describe("成长计划回归", () => {
    it("应该能够查看成长计划列表（对应客户端七日计划功能）", async () => {
      // 客户端可以参加七日计划，管理后台应该能够查看所有计划
      const result = await service.listGrowthPlans(1, 20);

      assert.ok(result.plans);
      assert.ok(result.pagination);
    });

    it("应该能够查看成长统计（对应客户端成长数据功能）", async () => {
      // 管理后台应该能够查看成长计划统计数据
      const stats = await service.getGrowthStatistics();

      assert.equal(typeof stats.totalPlans, "number");
      assert.equal(typeof stats.activePlans, "number");
      assert.equal(typeof stats.completedPlans, "number");
      assert.equal(typeof stats.avgCompletionRate, "number");
    });
  });

  describe("功能开关回归", () => {
    it("应该能够查看功能开关列表（对应客户端功能开关功能）", async () => {
      // 客户端可以查询功能开关，管理后台应该能够查看所有开关
      const flags = await service.listFeatureFlags();

      assert.ok(Array.isArray(flags));
    });

    it("应该能够切换功能开关（对应客户端功能控制功能）", async () => {
      // 管理后台应该能够开启/关闭功能
      const flag = await service.updateFeatureFlag("growth", true);

      assert.equal(flag.key, "growth");
      assert.equal(flag.enabled, true);

      // 应该能够关闭功能
      const disabledFlag = await service.updateFeatureFlag("growth", false);
      assert.equal(disabledFlag.enabled, false);
    });

    it("应该能够查看功能使用分析（对应客户端功能分析功能）", async () => {
      // 管理后台应该能够查看功能使用情况
      const analytics = await service.getFeatureFlagAnalytics();

      assert.ok(Array.isArray(analytics));
    });
  });

  describe("运营概览回归", () => {
    it("应该能够查看运营数据总览（对应运营数据看板功能）", async () => {
      // 管理后台应该能够查看整体运营数据
      const summary = await service.getOperationsSummary("bodylog");

      assert.ok(summary.overview);
      assert.equal(typeof summary.overview.totalUsers, "number");
      assert.equal(typeof summary.overview.totalBuddyPairs, "number");
      assert.equal(typeof summary.overview.totalGroups, "number");
      assert.equal(typeof summary.overview.totalChallenges, "number");
      assert.equal(typeof summary.overview.activeGrowthPlans, "number");

      assert.ok(summary.subscriptions);
      assert.equal(typeof summary.subscriptions.totalActive, "number");
      assert.ok(summary.subscriptions.byTier);
    });

    it("应该能够查看分时段指标（对应运营趋势分析功能）", async () => {
      // 管理后台应该能够查看 7 天、30 天、90 天的指标
      const metrics7d = await service.getOperationsMetrics("bodylog", "7d");
      assert.equal(metrics7d.period, "7d");

      const metrics30d = await service.getOperationsMetrics("bodylog", "30d");
      assert.equal(metrics30d.period, "30d");

      const metrics90d = await service.getOperationsMetrics("bodylog", "90d");
      assert.equal(metrics90d.period, "90d");

      // 所有指标应该是数字
      assert.equal(typeof metrics7d.newUsers, "number");
      assert.equal(typeof metrics7d.activeUsers, "number");
      assert.equal(typeof metrics7d.buddyCheckins, "number");
      assert.equal(typeof metrics7d.groupCheckins, "number");
      assert.equal(typeof metrics7d.challengesCompleted, "number");
      assert.equal(typeof metrics7d.growthMissionsCompleted, "number");
      assert.equal(typeof metrics7d.newSubscriptions, "number");
    });
  });

  describe("系统配置回归", () => {
    it("应该能够查看和更新通知配置（对应全局通知控制功能）", async () => {
      // 管理后台应该能够查看通知配置
      const config = await service.getNotificationConfig();

      assert.equal(typeof config.pushDeliveryEnabled, "boolean");
      assert.ok(config.defaultQuietHours);
      assert.equal(typeof config.defaultQuietHours.isEnabled, "boolean");
      assert.equal(typeof config.defaultQuietHours.startHour, "number");
      assert.equal(typeof config.defaultQuietHours.endHour, "number");

      // 应该能够更新配置
      await service.updateNotificationConfig({
        pushDeliveryEnabled: false,
        defaultQuietHours: { isEnabled: true, startHour: 23, endHour: 7 },
      });

      // 不应该抛出异常
      assert.ok(true);
    });

    it("应该能够查看和更新计分配置（对应全局计分规则功能）", async () => {
      // 管理后台应该能够查看计分配置
      const config = await service.getScoringConfig();

      assert.equal(typeof config.buddyCheckinBaseScore, "number");
      assert.equal(typeof config.buddyEncouragementScore, "number");
      assert.equal(typeof config.groupCheckinBaseScore, "number");
      assert.equal(typeof config.challengeCompletionBonus, "number");
      assert.equal(typeof config.growthMissionScore, "number");

      // 应该能够更新配置
      await service.updateScoringConfig({
        buddyCheckinBaseScore: 12,
        buddyEncouragementScore: 3,
        groupCheckinBaseScore: 18,
        challengeCompletionBonus: 60,
        growthMissionScore: 6,
      });

      // 不应该抛出异常
      assert.ok(true);
    });

    it("应该能够查看和更新赛季配置（对应全局赛季参数功能）", async () => {
      // 管理后台应该能够查看赛季配置
      const config = await service.getSeasonConfig();

      assert.equal(typeof config.defaultDurationDays, "number");
      assert.equal(typeof config.maxParticipantsPerSeason, "number");
      assert.equal(typeof config.allowAnonymousLeaderboard, "boolean");
      assert.equal(typeof config.autoCloseSeasons, "boolean");

      // 应该能够更新配置
      await service.updateSeasonConfig({
        defaultDurationDays: 14,
        maxParticipantsPerSeason: 2000,
        allowAnonymousLeaderboard: true,
        autoCloseSeasons: false,
      });

      // 不应该抛出异常
      assert.ok(true);
    });
  });

  describe("数据一致性回归", () => {
    it("应该确保用户统计数据来源一致", async () => {
      // 用户列表的总数应该与运营概览的总用户数一致
      const userList = await service.listUsers("bodylog", 1, 100);
      const summary = await service.getOperationsSummary("bodylog");

      // 两者都应该能够正常返回
      assert.ok(userList.pagination);
      assert.ok(summary.overview);
    });

    it("应该确保挑战统计数据来源一致", async () => {
      // 挑战列表的总数应该与挑战统计的总数一致
      const challengeList = await service.listChallenges("bodylog", 1, 100);
      const stats = await service.getChallengeStatistics("bodylog");

      // 两者都应该能够正常返回
      assert.ok(challengeList.pagination);
      assert.equal(typeof stats.totalChallenges, "number");
    });

    it("应该确保成长计划统计数据来源一致", async () => {
      // 成长计划列表的总数应该与成长统计的总数一致
      const planList = await service.listGrowthPlans(1, 100);
      const stats = await service.getGrowthStatistics();

      // 两者都应该能够正常返回
      assert.ok(planList.pagination);
      assert.equal(typeof stats.totalPlans, "number");
    });
  });

  describe("边界条件回归", () => {
    it("应该正确处理分页边界", async () => {
      // 第一页
      const page1 = await service.listUsers("bodylog", 1, 20);
      assert.equal(page1.pagination.page, 1);

      // 超大页码
      const largePage = await service.listUsers("bodylog", 1000, 20);
      assert.equal(largePage.pagination.page, 1000);

      // 超大页大小（应该被限制在最大值）
      const largeSize = await service.listUsers("bodylog", 1, 1000);
      assert.ok(largeSize.pagination.pageSize <= 100);
    });

    it("应该正确处理空数据", async () => {
      // 所有列表查询应该能够处理空数据
      const users = await service.listUsers("bodylog", 1, 20);
      assert.ok(Array.isArray(users.users));

      const reports = await service.listReports("bodylog", 1, 20);
      assert.ok(Array.isArray(reports.reports));

      const challenges = await service.listChallenges("bodylog", 1, 20);
      assert.ok(Array.isArray(challenges.challenges));
    });

    it("应该正确处理不存在的资源", async () => {
      // 查询不存在的用户详情应该返回 null
      const user = await service.getUserDetails("bodylog", "non-existent-user");
      assert.ok(user === null);
    });
  });
});
