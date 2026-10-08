import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import type { BodyLogAdminService } from "../modules/bodylog/bodylog-admin.service.ts";
import type { AdminUserStatus } from "../modules/bodylog/bodylog-admin.types.ts";
import { BODYLOG_APP_ID } from "../modules/bodylog/bodylog-profile.types.ts";
import { ApplicationError } from "../shared/errors.ts";

const ADMIN_PATH_PREFIX = "/api/v1/admin/apps/bodylog";

export async function tryHandleBodyLogManagementRoutes(
  context: BackendRouteContext,
  enabled: boolean,
  adminService: BodyLogAdminService | undefined,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (!request.path.startsWith(ADMIN_PATH_PREFIX)) {
    return undefined;
  }
  if (!enabled || !adminService) {
    throw new ApplicationError(404, "BODYLOG_NOT_ENABLED", "BodyLog is not available.");
  }

  const service = adminService;
  const appId = BODYLOG_APP_ID;
  const relativePath = request.path.slice(ADMIN_PATH_PREFIX.length) || "/";

  // Helper to parse pagination query params
  const pagination = () => {
    const q = request.query ?? {};
    return {
      page: q.page ? Number(q.page) : undefined,
      pageSize: q.pageSize ? Number(q.pageSize) : undefined,
      search: q.search as string | undefined,
    };
  };

  // ===== Operations Dashboard =====
  if (request.method === "GET" && relativePath === "/operations/summary") {
    const adminUser = context.authenticateAdmin(request);
    await context.recordAdminReadAudit(adminUser, "bodylog.operations.read", "app_operations", appId, request.requestId);
    const summary = await service.getOperationsSummary(appId);
    return context.ok({ app_id: appId, admin_user: adminUser, ...summary }, request.requestId as string);
  }

  if (request.method === "GET" && relativePath === "/operations/metrics") {
    const adminUser = context.authenticateAdmin(request);
    await context.recordAdminReadAudit(adminUser, "bodylog.operations.read", "app_operations", appId, request.requestId);
    const period = (request.query?.period as string) ?? "7d";
    if (!["7d", "30d", "90d"].includes(period)) {
      throw new ApplicationError(400, "BODYLOG_ADMIN_INVALID_PERIOD", "Period must be 7d, 30d, or 90d.");
    }
    const metrics = await service.getOperationsMetrics(appId, period as "7d" | "30d" | "90d");
    return context.ok({ app_id: appId, admin_user: adminUser, ...metrics }, request.requestId as string);
  }

  // ===== User Management =====
  if (request.method === "GET" && relativePath === "/users") {
    const adminUser = context.authenticateAdmin(request);
    const { page, pageSize, search } = pagination();
    await context.recordAdminReadAudit(adminUser, "bodylog.users.list", "user_list", appId, request.requestId);
    const result = await service.listUsers(appId, page, pageSize, search);
    return context.ok({ app_id: appId, admin_user: adminUser, ...result }, request.requestId as string);
  }

  // ===== Social Moderation: Reports =====
  if (request.method === "GET" && relativePath === "/reports") {
    const adminUser = context.authenticateAdmin(request);
    const { page, pageSize } = pagination();
    await context.recordAdminReadAudit(adminUser, "bodylog.reports.list", "report_list", appId, request.requestId);
    const result = await service.listReports(appId, page, pageSize);
    return context.ok({ app_id: appId, admin_user: adminUser, ...result }, request.requestId as string);
  }

  // ===== Social Moderation: Blocks =====
  if (request.method === "GET" && relativePath === "/blocks") {
    const adminUser = context.authenticateAdmin(request);
    const { page, pageSize } = pagination();
    await context.recordAdminReadAudit(adminUser, "bodylog.blocks.list", "block_list", appId, request.requestId);
    const result = await service.listBlocks(appId, page, pageSize);
    return context.ok({ app_id: appId, admin_user: adminUser, ...result }, request.requestId as string);
  }

  const blockMatch = relativePath.match(/^\/blocks\/([^/]+)\/([^/]+)$/);
  if (blockMatch && request.method === "DELETE") {
    const session = context.requireAdminSession(request);
    const [, blockerUserId, blockedUserId] = blockMatch;
    await context.auditInterceptor.record({
      appId,
      action: "bodylog.block.remove",
      resourceType: "block",
      resourceId: `${blockerUserId}:${blockedUserId}`,
      payload: { adminUser: session.adminUser, blockerUserId, blockedUserId },
    });
    await service.removeBlock(appId, decodeURIComponent(blockerUserId), decodeURIComponent(blockedUserId));
    return context.ok({ app_id: appId, admin_user: session.adminUser, removed: true }, request.requestId as string);
  }

  // ===== Leaderboard Management =====
  if (request.method === "GET" && relativePath === "/leaderboards/seasons") {
    const adminUser = context.authenticateAdmin(request);
    const { page, pageSize } = pagination();
    await context.recordAdminReadAudit(adminUser, "bodylog.leaderboards.seasons.list", "season_list", appId, request.requestId);
    const result = await service.listSeasons(appId, page, pageSize);
    return context.ok({ app_id: appId, admin_user: adminUser, ...result }, request.requestId as string);
  }

  const seasonRankingsMatch = relativePath.match(/^\/leaderboards\/seasons\/([^/]+)\/rankings$/);
  if (seasonRankingsMatch && request.method === "GET") {
    const adminUser = context.authenticateAdmin(request);
    const seasonLabel = decodeURIComponent(seasonRankingsMatch[1]);
    const { page, pageSize } = pagination();
    await context.recordAdminReadAudit(adminUser, "bodylog.leaderboards.rankings.read", "season", seasonLabel, request.requestId);
    const result = await service.listSeasonRankings(appId, seasonLabel, page, pageSize);
    return context.ok({ app_id: appId, admin_user: adminUser, ...result }, request.requestId as string);
  }

  const seasonEntryMatch = relativePath.match(/^\/leaderboards\/seasons\/([^/]+)\/entries\/([^/]+)$/);
  if (seasonEntryMatch && request.method === "DELETE") {
    const session = context.requireAdminSession(request);
    const [, seasonLabel, userId] = seasonEntryMatch;
    await context.auditInterceptor.record({
      appId,
      action: "bodylog.leaderboard.entry.remove",
      resourceType: "leaderboard_entry",
      resourceId: `${seasonLabel}:${userId}`,
      payload: { adminUser: session.adminUser, seasonLabel, userId },
    });
    await service.removeSeasonEntry(appId, decodeURIComponent(seasonLabel), decodeURIComponent(userId));
    return context.ok({ app_id: appId, admin_user: session.adminUser, removed: true }, request.requestId as string);
  }

  // ===== Challenge Management =====
  if (request.method === "GET" && relativePath === "/challenges") {
    const adminUser = context.authenticateAdmin(request);
    const { page, pageSize } = pagination();
    await context.recordAdminReadAudit(adminUser, "bodylog.challenges.list", "challenge_list", appId, request.requestId);
    const result = await service.listChallenges(appId, page, pageSize);
    return context.ok({ app_id: appId, admin_user: adminUser, ...result }, request.requestId as string);
  }

  if (request.method === "GET" && relativePath === "/challenges/statistics") {
    const adminUser = context.authenticateAdmin(request);
    await context.recordAdminReadAudit(adminUser, "bodylog.challenges.statistics", "challenge_statistics", appId, request.requestId);
    const stats = await service.getChallengeStatistics(appId);
    return context.ok({ app_id: appId, admin_user: adminUser, statistics: stats }, request.requestId as string);
  }

  // ===== Reward Management =====
  if (request.method === "GET" && relativePath === "/rewards") {
    const adminUser = context.authenticateAdmin(request);
    const { page, pageSize } = pagination();
    await context.recordAdminReadAudit(adminUser, "bodylog.rewards.list", "reward_list", appId, request.requestId);
    const result = await service.listRewards(page, pageSize);
    return context.ok({ app_id: appId, admin_user: adminUser, ...result }, request.requestId as string);
  }

  if (request.method === "GET" && relativePath === "/rewards/statistics") {
    const adminUser = context.authenticateAdmin(request);
    await context.recordAdminReadAudit(adminUser, "bodylog.rewards.statistics", "reward_statistics", appId, request.requestId);
    const stats = await service.getRewardStatistics();
    return context.ok({ app_id: appId, admin_user: adminUser, statistics: stats }, request.requestId as string);
  }

  // ===== Feature Flag Management =====
  if (request.method === "GET" && relativePath === "/feature-flags") {
    const adminUser = context.authenticateAdmin(request);
    await context.recordAdminReadAudit(adminUser, "bodylog.feature_flags.list", "feature_flags", appId, request.requestId);
    const flags = await service.listFeatureFlags();
    return context.ok({ app_id: appId, admin_user: adminUser, feature_flags: flags }, request.requestId as string);
  }

  const flagMatch = relativePath.match(/^\/feature-flags\/([^/]+)$/);
  if (flagMatch && request.method === "PUT") {
    const session = context.requireAdminSession(request);
    const key = decodeURIComponent(flagMatch[1]);
    const body = request.body && typeof request.body === "object" && !Array.isArray(request.body)
      ? request.body as Record<string, unknown>
      : {};
    const enabled = typeof body.enabled === "boolean" ? body.enabled : undefined;
    if (enabled === undefined) {
      throw new ApplicationError(400, "BODYLOG_ADMIN_INVALID_FLAG", "enabled must be a boolean.");
    }
    await context.auditInterceptor.record({
      appId,
      action: "bodylog.feature_flag.update",
      resourceType: "feature_flag",
      resourceId: key,
      payload: { adminUser: session.adminUser, key, enabled },
    });
    const flag = await service.updateFeatureFlag(key, enabled);
    return context.ok({ app_id: appId, admin_user: session.adminUser, ...flag }, request.requestId as string);
  }

  if (request.method === "GET" && relativePath === "/feature-flags/analytics") {
    const adminUser = context.authenticateAdmin(request);
    await context.recordAdminReadAudit(adminUser, "bodylog.feature_flags.analytics", "feature_flag_analytics", appId, request.requestId);
    const analytics = await service.getFeatureFlagAnalytics();
    return context.ok({ app_id: appId, admin_user: adminUser, analytics }, request.requestId as string);
  }

  // ===== Growth Plan Management =====
  if (request.method === "GET" && relativePath === "/growth/plans") {
    const adminUser = context.authenticateAdmin(request);
    const { page, pageSize } = pagination();
    await context.recordAdminReadAudit(adminUser, "bodylog.growth.plans.list", "growth_plan_list", appId, request.requestId);
    const result = await service.listGrowthPlans(page, pageSize);
    return context.ok({ app_id: appId, admin_user: adminUser, ...result }, request.requestId as string);
  }

  if (request.method === "GET" && relativePath === "/growth/statistics") {
    const adminUser = context.authenticateAdmin(request);
    await context.recordAdminReadAudit(adminUser, "bodylog.growth.statistics", "growth_statistics", appId, request.requestId);
    const stats = await service.getGrowthStatistics();
    return context.ok({ app_id: appId, admin_user: adminUser, statistics: stats }, request.requestId as string);
  }

  const growthPlanMatch = relativePath.match(/^\/growth\/plans\/([^/]+)$/);
  if (growthPlanMatch && request.method === "GET") {
    const adminUser = context.authenticateAdmin(request);
    const planId = decodeURIComponent(growthPlanMatch[1]);
    await context.recordAdminReadAudit(adminUser, "bodylog.growth.plan.read", "growth_plan", planId, request.requestId);
    const plan = await service.getGrowthPlanDetails(planId);
    if (!plan) {
      throw new ApplicationError(404, "BODYLOG_ADMIN_GROWTH_PLAN_NOT_FOUND", "Growth plan not found.");
    }
    return context.ok({ app_id: appId, admin_user: adminUser, ...plan }, request.requestId as string);
  }

  // ===== Reward Management: Manual Issue =====

  if (request.method === "POST" && relativePath === "/rewards/manual-issue") {
    const session = context.requireAdminSession(request);
    const body = request.body && typeof request.body === "object" && !Array.isArray(request.body)
      ? request.body as Record<string, unknown>
      : {};
    const planId = typeof body.planId === "string" ? body.planId : undefined;
    const userId = typeof body.userId === "string" ? body.userId : undefined;
    const type = typeof body.type === "string" ? body.type : undefined;
    const value = typeof body.value === "string" ? body.value : undefined;
    if (!planId || !userId || !type || !value) {
      throw new ApplicationError(400, "BODYLOG_ADMIN_INVALID_REWARD", "planId, userId, type, and value are required.");
    }
    await context.auditInterceptor.record({
      appId,
      action: "bodylog.reward.manual_issue",
      resourceType: "reward",
      resourceId: `${planId}:${userId}`,
      payload: { adminUser: session.adminUser, planId, userId, type, value },
    });
    const reward = await service.manualIssueReward({ planId, userId, type, value });
    return context.ok({ app_id: appId, admin_user: session.adminUser, ...reward }, request.requestId as string);
  }

  // ===== Challenge Details =====

  const challengeMatch = relativePath.match(/^\/challenges\/([^/]+)$/);
  if (challengeMatch && request.method === "GET") {
    const adminUser = context.authenticateAdmin(request);
    const challengeId = decodeURIComponent(challengeMatch[1]);
    await context.recordAdminReadAudit(adminUser, "bodylog.challenge.read", "challenge", challengeId, request.requestId);
    const challenge = await service.getChallengeDetails(appId, challengeId);
    if (!challenge) {
      throw new ApplicationError(404, "BODYLOG_ADMIN_CHALLENGE_NOT_FOUND", "Challenge not found.");
    }
    return context.ok({ app_id: appId, admin_user: adminUser, ...challenge }, request.requestId as string);
  }

  // ===== Report Resolution =====

  const reportMatch = relativePath.match(/^\/reports\/([^/]+)\/resolve$/);
  if (reportMatch && request.method === "POST") {
    const session = context.requireAdminSession(request);
    const reportId = decodeURIComponent(reportMatch[1]);
    const body = request.body && typeof request.body === "object" && !Array.isArray(request.body)
      ? request.body as Record<string, unknown>
      : {};
    const resolution = typeof body.resolution === "string" ? body.resolution : undefined;
    if (!resolution) {
      throw new ApplicationError(400, "BODYLOG_ADMIN_INVALID_RESOLUTION", "resolution is required.");
    }
    await context.auditInterceptor.record({
      appId,
      action: "bodylog.report.resolve",
      resourceType: "report",
      resourceId: reportId,
      payload: { adminUser: session.adminUser, reportId, resolution },
    });
    await service.resolveReport(reportId, session.adminUser, resolution);
    return context.ok({ app_id: appId, admin_user: session.adminUser, resolved: true }, request.requestId as string);
  }

  // ===== User Details =====

  const userMatch = relativePath.match(/^\/users\/([^/]+)$/);
  if (userMatch && request.method === "GET") {
    const adminUser = context.authenticateAdmin(request);
    const userId = decodeURIComponent(userMatch[1]);
    await context.recordAdminReadAudit(adminUser, "bodylog.user.read", "user", userId, request.requestId);
    const user = await service.getUserDetails(appId, userId);
    if (!user) {
      throw new ApplicationError(404, "BODYLOG_ADMIN_USER_NOT_FOUND", "User not found.");
    }
    return context.ok({ app_id: appId, admin_user: adminUser, ...user }, request.requestId as string);
  }

  const userStatusMatch = relativePath.match(/^\/users\/([^/]+)\/status$/);
  if (userStatusMatch && request.method === "PUT") {
    const session = context.requireAdminSession(request);
    const userId = decodeURIComponent(userStatusMatch[1]);
    const body = request.body && typeof request.body === "object" && !Array.isArray(request.body)
      ? request.body as Record<string, unknown>
      : {};
    const status = typeof body.status === "string" ? body.status : undefined;
    if (!status || !["active", "banned", "suspended"].includes(status)) {
      throw new ApplicationError(400, "BODYLOG_ADMIN_INVALID_STATUS", "status must be active, banned, or suspended.");
    }
    await context.auditInterceptor.record({
      appId,
      action: "bodylog.user.status.update",
      resourceType: "user",
      resourceId: userId,
      payload: { adminUser: session.adminUser, userId, status },
    });
    await service.updateUserStatus(appId, userId, status as AdminUserStatus);
    return context.ok({ app_id: appId, admin_user: session.adminUser, updated: true }, request.requestId as string);
  }

  const userDataMatch = relativePath.match(/^\/users\/([^/]+)\/data$/);
  if (userDataMatch && request.method === "DELETE") {
    const session = context.requireAdminSession(request);
    const userId = decodeURIComponent(userDataMatch[1]);
    await context.auditInterceptor.record({
      appId,
      action: "bodylog.user.data.reset",
      resourceType: "user",
      resourceId: userId,
      payload: { adminUser: session.adminUser, userId },
    });
    await service.resetUserData(appId, userId);
    return context.ok({ app_id: appId, admin_user: session.adminUser, reset: true }, request.requestId as string);
  }

  // ===== System Configuration =====

  if (request.method === "GET" && relativePath === "/config/notifications") {
    const adminUser = context.authenticateAdmin(request);
    await context.recordAdminReadAudit(adminUser, "bodylog.config.notifications.read", "config", "notifications", request.requestId);
    const config = await service.getNotificationConfig();
    return context.ok({ app_id: appId, admin_user: adminUser, ...config }, request.requestId as string);
  }

  if (request.method === "PUT" && relativePath === "/config/notifications") {
    const session = context.requireAdminSession(request);
    const body = request.body && typeof request.body === "object" && !Array.isArray(request.body)
      ? request.body as Record<string, unknown>
      : {};
    const pushDeliveryEnabled = typeof body.pushDeliveryEnabled === "boolean" ? body.pushDeliveryEnabled : undefined;
    const defaultQuietHours = body.defaultQuietHours && typeof body.defaultQuietHours === "object" && !Array.isArray(body.defaultQuietHours)
      ? body.defaultQuietHours as Record<string, unknown>
      : undefined;
    if (pushDeliveryEnabled === undefined || !defaultQuietHours) {
      throw new ApplicationError(400, "BODYLOG_ADMIN_INVALID_CONFIG", "pushDeliveryEnabled and defaultQuietHours are required.");
    }
    const isEnabled = typeof defaultQuietHours.isEnabled === "boolean" ? defaultQuietHours.isEnabled : undefined;
    const startHour = typeof defaultQuietHours.startHour === "number" ? defaultQuietHours.startHour : undefined;
    const endHour = typeof defaultQuietHours.endHour === "number" ? defaultQuietHours.endHour : undefined;
    if (isEnabled === undefined || startHour === undefined || endHour === undefined) {
      throw new ApplicationError(400, "BODYLOG_ADMIN_INVALID_CONFIG", "defaultQuietHours must include isEnabled, startHour, and endHour.");
    }
    await context.auditInterceptor.record({
      appId,
      action: "bodylog.config.notifications.update",
      resourceType: "config",
      resourceId: "notifications",
      payload: { adminUser: session.adminUser, config: { pushDeliveryEnabled, defaultQuietHours: { isEnabled, startHour, endHour } } },
    });
    await service.updateNotificationConfig({ pushDeliveryEnabled, defaultQuietHours: { isEnabled, startHour, endHour } });
    return context.ok({ app_id: appId, admin_user: session.adminUser, updated: true }, request.requestId as string);
  }

  if (request.method === "GET" && relativePath === "/config/scoring") {
    const adminUser = context.authenticateAdmin(request);
    await context.recordAdminReadAudit(adminUser, "bodylog.config.scoring.read", "config", "scoring", request.requestId);
    const config = await service.getScoringConfig();
    return context.ok({ app_id: appId, admin_user: adminUser, ...config }, request.requestId as string);
  }

  if (request.method === "PUT" && relativePath === "/config/scoring") {
    const session = context.requireAdminSession(request);
    const body = request.body && typeof request.body === "object" && !Array.isArray(request.body)
      ? request.body as Record<string, unknown>
      : {};
    const buddyCheckinBaseScore = typeof body.buddyCheckinBaseScore === "number" ? body.buddyCheckinBaseScore : undefined;
    const buddyEncouragementScore = typeof body.buddyEncouragementScore === "number" ? body.buddyEncouragementScore : undefined;
    const groupCheckinBaseScore = typeof body.groupCheckinBaseScore === "number" ? body.groupCheckinBaseScore : undefined;
    const challengeCompletionBonus = typeof body.challengeCompletionBonus === "number" ? body.challengeCompletionBonus : undefined;
    const growthMissionScore = typeof body.growthMissionScore === "number" ? body.growthMissionScore : undefined;
    if (buddyCheckinBaseScore === undefined || buddyEncouragementScore === undefined || groupCheckinBaseScore === undefined || challengeCompletionBonus === undefined || growthMissionScore === undefined) {
      throw new ApplicationError(400, "BODYLOG_ADMIN_INVALID_CONFIG", "All scoring fields are required.");
    }
    const config = { buddyCheckinBaseScore, buddyEncouragementScore, groupCheckinBaseScore, challengeCompletionBonus, growthMissionScore };
    await context.auditInterceptor.record({
      appId,
      action: "bodylog.config.scoring.update",
      resourceType: "config",
      resourceId: "scoring",
      payload: { adminUser: session.adminUser, config },
    });
    await service.updateScoringConfig(config);
    return context.ok({ app_id: appId, admin_user: session.adminUser, updated: true }, request.requestId as string);
  }

  if (request.method === "GET" && relativePath === "/config/seasons") {
    const adminUser = context.authenticateAdmin(request);
    await context.recordAdminReadAudit(adminUser, "bodylog.config.seasons.read", "config", "seasons", request.requestId);
    const config = await service.getSeasonConfig();
    return context.ok({ app_id: appId, admin_user: adminUser, ...config }, request.requestId as string);
  }

  if (request.method === "PUT" && relativePath === "/config/seasons") {
    const session = context.requireAdminSession(request);
    const body = request.body && typeof request.body === "object" && !Array.isArray(request.body)
      ? request.body as Record<string, unknown>
      : {};
    const defaultDurationDays = typeof body.defaultDurationDays === "number" ? body.defaultDurationDays : undefined;
    const maxParticipantsPerSeason = typeof body.maxParticipantsPerSeason === "number" ? body.maxParticipantsPerSeason : undefined;
    const allowAnonymousLeaderboard = typeof body.allowAnonymousLeaderboard === "boolean" ? body.allowAnonymousLeaderboard : undefined;
    const autoCloseSeasons = typeof body.autoCloseSeasons === "boolean" ? body.autoCloseSeasons : undefined;
    if (defaultDurationDays === undefined || maxParticipantsPerSeason === undefined || allowAnonymousLeaderboard === undefined || autoCloseSeasons === undefined) {
      throw new ApplicationError(400, "BODYLOG_ADMIN_INVALID_CONFIG", "All season config fields are required.");
    }
    const config = { defaultDurationDays, maxParticipantsPerSeason, allowAnonymousLeaderboard, autoCloseSeasons };
    await context.auditInterceptor.record({
      appId,
      action: "bodylog.config.seasons.update",
      resourceType: "config",
      resourceId: "seasons",
      payload: { adminUser: session.adminUser, config },
    });
    await service.updateSeasonConfig(config);
    return context.ok({ app_id: appId, admin_user: session.adminUser, updated: true }, request.requestId as string);
  }

  return undefined;
}
