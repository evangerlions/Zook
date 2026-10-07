import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import type { BodyLogAdminService } from "../modules/bodylog/bodylog-admin.service.ts";
import { BODYLOG_APP_ID } from "../modules/bodylog/bodylog-profile.types.ts";
import { ApplicationError } from "../shared/errors.ts";

const ADMIN_PATH_PREFIX = "/api/v1/admin/apps/bodylog";

export async function tryHandleBodyLogAdminRoutes(
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
    const result = await service.listSeasons(page, pageSize);
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

  return undefined;
}
