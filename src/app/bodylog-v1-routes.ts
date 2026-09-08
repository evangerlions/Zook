import type { BodyLogProfileService } from "../modules/bodylog/bodylog-profile.service.ts";
import type { BodyLogSocialService } from "../modules/bodylog/bodylog-social.service.ts";
import type { BodyLogLeaderboardService } from "../modules/bodylog/bodylog-leaderboard.service.ts";
import type { BodyLogInvitationService } from "../modules/bodylog/bodylog-invitation.service.ts";
import type { BodyLogChallengeService } from "../modules/bodylog/bodylog-challenge.service.ts";
import type { BodyLogBuddyService } from "../modules/bodylog/bodylog-buddy.service.ts";
import type { BodyLogGroupService } from "../modules/bodylog/bodylog-group.service.ts";
import type { BodyLogGrowthService } from "../modules/bodylog/bodylog-growth.service.ts";
import type { BodyLogNotificationService } from "../modules/bodylog/bodylog-notification.service.ts";
import type { BodyLogFeatureFlagService } from "../modules/bodylog/bodylog-feature-flag.service.ts";
import { BODYLOG_APP_ID } from "../modules/bodylog/bodylog-profile.types.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { ApplicationError } from "../shared/errors.ts";
import { ValidationPipe } from "../core/pipes/validation.pipe.ts";
import type { BuddyEncouragementEmoji } from "../modules/bodylog/bodylog-buddy.types.ts";
import type { NotificationCategory } from "../modules/bodylog/bodylog-notification.types.ts";

const BODYLOG_PROFILE_PATH = "/api/v1/bodylog/profile";
const validation = new ValidationPipe();

function requestBody(request: HttpRequest): Record<string, unknown> {
  return request.body && typeof request.body === "object" && !Array.isArray(request.body)
    ? request.body as Record<string, unknown>
    : {};
}

export async function tryHandleBodyLogV1Routes(
  context: BackendRouteContext,
  profileService: BodyLogProfileService,
  socialService: BodyLogSocialService,
  leaderboardService: BodyLogLeaderboardService,
  invitationService: BodyLogInvitationService,
  challengeService: BodyLogChallengeService,
  buddyService: BodyLogBuddyService,
  groupService: BodyLogGroupService,
  growthService: BodyLogGrowthService,
  notificationService: BodyLogNotificationService,
  featureFlagService: BodyLogFeatureFlagService,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (!request.path.startsWith("/api/v1/bodylog/")) {
    return undefined;
  }

  // 公开配置（功能开关）无需鉴权，必须在 authenticateProductRequest 之前处理，
  // 否则匿名请求会被拦截；同时避免被通用的 admin.delivery_config 处理器遮蔽。
  if (request.path === "/api/v1/bodylog/public/config" && request.method === "GET") {
    const config = await featureFlagService.getAllFlags();
    return context.ok(config, request.requestId as string);
  }

  const auth = await context.authenticateProductRequest(request, BODYLOG_APP_ID);
  if (request.path.startsWith("/api/v1/bodylog/seven-day-plan/") && !(await featureFlagService.isEnabled("growth"))) {
    throw new ApplicationError(404, "BODYLOG_FEATURE_DISABLED", "Feature is not available.");
  }
  if (request.path === BODYLOG_PROFILE_PATH && request.method === "GET") {
    const profile = await profileService.getOrCreate(auth.userId);
    return context.ok(profile, request.requestId as string);
  }
  if (request.path === BODYLOG_PROFILE_PATH && request.method === "PUT") {
    const body = requestBody(request);
    const profile = await profileService.update(
      auth.userId,
      {
        nickname: body.nickname,
        avatarKey: body.avatarKey,
      },
      request.requestId,
    );
    return context.ok(profile, request.requestId as string);
  }
  if (request.path === "/api/v1/bodylog/friends" && request.method === "GET") {
    return context.ok(await socialService.listFriends(auth.userId), request.requestId as string);
  }
  if (request.path === "/api/v1/bodylog/friend-requests" && request.method === "GET") {
    return context.ok(await socialService.listRequests(auth.userId), request.requestId as string);
  }
  if (request.path === "/api/v1/bodylog/friend-requests" && request.method === "POST") {
    return context.ok(
      await socialService.createRequest(auth.userId, requestBody(request).targetUserId),
      request.requestId as string,
    );
  }
  const responseMatch = request.path.match(/^\/api\/v1\/bodylog\/friend-requests\/([^/]+)\/(accept|reject)$/);
  if (responseMatch && request.method === "POST") {
    return context.ok(
      await socialService.respond(auth.userId, responseMatch[1] as string, responseMatch[2] as "accept" | "reject"),
      request.requestId as string,
    );
  }
  const friendMatch = request.path.match(/^\/api\/v1\/bodylog\/friends\/([^/]+)$/);
  if (friendMatch && request.method === "DELETE") {
    await socialService.removeFriend(auth.userId, friendMatch[1] as string);
    return context.ok({ removed: true }, request.requestId as string);
  }
  if (request.path === "/api/v1/bodylog/blocks" && request.method === "GET") {
    return context.ok(await socialService.listBlocks(auth.userId), request.requestId as string);
  }
  if (request.path === "/api/v1/bodylog/blocks" && request.method === "POST") {
    await socialService.block(auth.userId, requestBody(request).targetUserId);
    return context.ok({ blocked: true }, request.requestId as string);
  }
  const blockMatch = request.path.match(/^\/api\/v1\/bodylog\/blocks\/([^/]+)$/);
  if (blockMatch && request.method === "DELETE") {
    await socialService.unblock(auth.userId, blockMatch[1] as string);
    return context.ok({ blocked: false }, request.requestId as string);
  }
  if (request.path === "/api/v1/bodylog/reports" && request.method === "POST") {
    const body = requestBody(request);
    return context.ok(
      await socialService.report(auth.userId, body.targetUserId, body.reason),
      request.requestId as string,
    );
  }
  if (request.path === "/api/v1/bodylog/leaderboards/current/join" && request.method === "POST") {
    const body = requestBody(request);
    return context.ok(await leaderboardService.join(auth.userId, {
      seasonLabel: body.seasonLabel, timezone: body.timezone, habits: body.habits,
    }), request.requestId as string);
  }
  if (request.path === "/api/v1/bodylog/leaderboards/current/aggregate" && request.method === "POST") {
    const body = requestBody(request);
    return context.ok(await leaderboardService.submitAggregate(auth.userId, {
      seasonLabel: body.seasonLabel, date: body.date,
      completedHabitIds: body.completedHabitIds,
    }), request.requestId as string);
  }
  if (request.path === "/api/v1/bodylog/leaderboards/current/membership" && request.method === "DELETE") {
    return context.ok(
      await leaderboardService.leave(auth.userId, requestBody(request).timezone),
      request.requestId as string,
    );
  }
  if (request.path === "/api/v1/bodylog/leaderboards/current/public" && request.method === "GET") {
    return context.ok(
      await leaderboardService.publicBoard(auth.userId, request.headers["x-time-zone"] ?? "UTC"),
      request.requestId as string,
    );
  }
  if (request.path === "/api/v1/bodylog/leaderboards/current/friends" && request.method === "GET") {
    return context.ok(
      await leaderboardService.friendBoard(auth.userId, request.headers["x-time-zone"] ?? "UTC"),
      request.requestId as string,
    );
  }
  if (request.path === "/api/v1/bodylog/invitations" && request.method === "POST") {
    const body = requestBody(request);
    const intent = body.intent === "buddy" ? "buddy" : body.intent === "group" ? "group" : "general";
    return context.ok(
      await invitationService.create(auth.userId, requestBody(request).installId, intent),
      request.requestId as string,
    );
  }
  if (request.path === "/api/v1/bodylog/invitations" && request.method === "GET") {
    return context.ok(
      await invitationService.list(auth.userId),
      request.requestId as string,
    );
  }
  if (request.path === "/api/v1/bodylog/invitations/attribute" && request.method === "POST") {
    const body = requestBody(request);
    return context.ok(
      await invitationService.attribute(auth.userId, {
        token: body.token, installId: body.installId,
      }),
      request.requestId as string,
    );
  }
  if (request.path === "/api/v1/bodylog/invitations/progress" && request.method === "POST") {
    const body = requestBody(request);
    return context.ok(
      await invitationService.recordProgress(auth.userId, {
        date: body.date, timezone: body.timezone,
      }),
      request.requestId as string,
    );
  }
  if (request.path === "/api/v1/bodylog/challenges" && request.method === "POST") {
    const body = requestBody(request);
    return context.ok(
      await challengeService.create(auth.userId, {
        themeKey: body.themeKey, inviteeUserIds: body.inviteeUserIds,
        timezone: body.timezone,
      }),
      request.requestId as string,
    );
  }
  if (request.path === "/api/v1/bodylog/challenges" && request.method === "GET") {
    return context.ok(
      await challengeService.list(auth.userId),
      request.requestId as string,
    );
  }
  const challengeMatch = request.path.match(/^\/api\/v1\/bodylog\/challenges\/([^/]+)$/);
  if (challengeMatch && request.method === "GET") {
    return context.ok(
      await challengeService.get(auth.userId, challengeMatch[1] as string),
      request.requestId as string,
    );
  }
  const challengeResponseMatch = request.path.match(/^\/api\/v1\/bodylog\/challenges\/([^/]+)\/respond$/);
  if (challengeResponseMatch && request.method === "POST") {
    return context.ok(
      await challengeService.respond(
        auth.userId, challengeResponseMatch[1] as string,
        requestBody(request).action,
      ),
      request.requestId as string,
    );
  }
  const challengeProgressMatch = request.path.match(/^\/api\/v1\/bodylog\/challenges\/([^/]+)\/progress$/);
  if (challengeProgressMatch && request.method === "POST") {
    const body = requestBody(request);
    return context.ok(
      await challengeService.recordProgress(
        auth.userId, challengeProgressMatch[1] as string,
        { date: body.date, completed: body.completed, timezone: body.timezone },
      ),
      request.requestId as string,
    );
  }

  // ===== 搭子配对路由 =====
  if (request.path === "/api/v1/bodylog/buddies" && request.method === "POST") {
    const body = requestBody(request);
    const result = await buddyService.createPair(auth.userId, {
      partnerUserId: validation.requireString(body, "partnerUserId"),
      sharedHabitIds: validation.requireArray<string>(body, "sharedHabitIds"),
    });
    return context.ok(
      { pair: result.pair, invitationUrl: result.invitationUrl },
      request.requestId as string,
    );
  }
  if (request.path === "/api/v1/bodylog/buddies" && request.method === "GET") {
    const buddies = await buddyService.getMyBuddies(auth.userId);
    return context.ok({ buddies, total: buddies.length }, request.requestId as string);
  }
  const buddyPairMatch = request.path.match(/^\/api\/v1\/bodylog\/buddies\/([^/]+)$/);
  if (buddyPairMatch && request.method === "GET") {
    const detail = await buddyService.getBuddyDetail(auth.userId, buddyPairMatch[1] as string);
    return context.ok(detail, request.requestId as string);
  }
  const buddyAcceptMatch = request.path.match(/^\/api\/v1\/bodylog\/buddies\/([^/]+)\/accept$/);
  if (buddyAcceptMatch && request.method === "POST") {
    const pair = await buddyService.acceptPair(auth.userId, buddyAcceptMatch[1] as string);
    return context.ok(pair, request.requestId as string);
  }
  const buddyDissolveMatch = request.path.match(/^\/api\/v1\/bodylog\/buddies\/([^/]+)\/dissolve$/);
  if (buddyDissolveMatch && request.method === "POST") {
    await buddyService.dissolvePair(auth.userId, buddyDissolveMatch[1] as string);
    return context.ok({ dissolved: true }, request.requestId as string);
  }
  if (request.path === "/api/v1/bodylog/buddies/encourage" && request.method === "POST") {
    const body = requestBody(request);
    const encouragement = await buddyService.encourage(auth.userId, {
      pairId: validation.requireString(body, "pairId"),
      emoji: validation.requireString(body, "emoji") as BuddyEncouragementEmoji,
      isSameAction: validation.optionalBoolean(body, "isSameAction") ?? false,
      targetHabitId: validation.optionalString(body, "targetHabitId"),
    });
    return context.ok(encouragement, request.requestId as string);
  }
  if (request.path === "/api/v1/bodylog/buddies/checkin" && request.method === "POST") {
    const body = requestBody(request);
    await buddyService.recordCheckin(auth.userId, validation.requireString(body, "habitId"), body.count === undefined ? 1 : validation.requireNumber(body, "count"));
    return context.ok({ recorded: true }, request.requestId as string);
  }

  // Group routes
  if (request.path === "/api/v1/bodylog/groups" && request.method === "POST") {
    const body = requestBody(request);
    const result = await groupService.createGroup(auth.userId, {
      name: body.name as string,
      icon: body.icon as string | undefined,
      sharedHabitIds: body.sharedHabitIds as string[],
      completionRule: body.completionRule as "all" | "majority" | undefined,
      maxMembers: body.maxMembers as number | undefined,
    });
    return context.ok(result, request.requestId as string);
  }
  if (request.path === "/api/v1/bodylog/groups" && request.method === "GET") {
    const groups = await groupService.getMyGroups(auth.userId);
    return context.ok({ groups, total: groups.length }, request.requestId as string);
  }
  const groupMatch = request.path.match(/^\/api\/v1\/bodylog\/groups\/([^/]+)$/);
  if (groupMatch && request.method === "GET") {
    const detail = await groupService.getGroupDetail(auth.userId, groupMatch[1] as string);
    return context.ok(detail, request.requestId as string);
  }
  const groupInviteMatch = request.path.match(/^\/api\/v1\/bodylog\/groups\/([^/]+)\/invite$/);
  if (groupInviteMatch && request.method === "POST") {
    const body = requestBody(request);
    await groupService.inviteMember(auth.userId, groupInviteMatch[1] as string, body.userId as string);
    return context.ok({ invited: true }, request.requestId as string);
  }
  const groupAcceptMatch = request.path.match(/^\/api\/v1\/bodylog\/groups\/([^/]+)\/accept$/);
  if (groupAcceptMatch && request.method === "POST") {
    const body = requestBody(request);
    const group = await groupService.acceptInvite(auth.userId, groupAcceptMatch[1] as string, body.token as string);
    return context.ok(group, request.requestId as string);
  }
  const groupLeaveMatch = request.path.match(/^\/api\/v1\/bodylog\/groups\/([^/]+)\/leave$/);
  if (groupLeaveMatch && request.method === "POST") {
    await groupService.leaveGroup(auth.userId, groupLeaveMatch[1] as string);
    return context.ok({ left: true }, request.requestId as string);
  }
  const groupCheckinMatch = request.path.match(/^\/api\/v1\/bodylog\/groups\/([^/]+)\/checkin$/);
  if (groupCheckinMatch && request.method === "POST") {
    const body = requestBody(request);
    await groupService.recordGroupCheckin(auth.userId, groupCheckinMatch[1] as string, {
      habitId: body.habitId as string,
      count: body.count as number | undefined,
    });
    return context.ok({ recorded: true }, request.requestId as string);
  }

  // ===== Growth (7-day plan) routes =====
  if (request.path === "/api/v1/bodylog/seven-day-plan/enroll" && request.method === "POST") {
    const plan = await growthService.enroll(auth.userId);
    return context.ok(plan, request.requestId as string);
  }
  if (request.path === "/api/v1/bodylog/seven-day-plan/active" && request.method === "GET") {
    const plan = await growthService.getActivePlan(auth.userId);
    return context.ok(plan, request.requestId as string);
  }
  const planMatch = request.path.match(/^\/api\/v1\/bodylog\/seven-day-plan\/([^/]+)$/);
  if (planMatch && request.method === "GET") {
    const plan = await growthService.getPlan(auth.userId, planMatch[1] as string);
    return context.ok(plan, request.requestId as string);
  }
  const missionsMatch = request.path.match(/^\/api\/v1\/bodylog\/seven-day-plan\/([^/]+)\/missions$/);
  if (missionsMatch && request.method === "GET") {
    const missions = await growthService.getMissions(auth.userId, missionsMatch[1] as string);
    return context.ok(missions, request.requestId as string);
  }
  const completeMissionMatch = request.path.match(/^\/api\/v1\/bodylog\/seven-day-plan\/([^/]+)\/missions\/([^/]+)\/complete$/);
  if (completeMissionMatch && request.method === "POST") {
    const mission = await growthService.completeMission(
      auth.userId,
      completeMissionMatch[1] as string,
      completeMissionMatch[2] as string,
    );
    return context.ok(mission, request.requestId as string);
  }
  const rewardsMatch = request.path.match(/^\/api\/v1\/bodylog\/seven-day-plan\/([^/]+)\/rewards$/);
  if (rewardsMatch && request.method === "GET") {
    const rewards = await growthService.getRewards(auth.userId, rewardsMatch[1] as string);
    return context.ok(rewards, request.requestId as string);
  }
  const claimRewardMatch = request.path.match(/^\/api\/v1\/bodylog\/seven-day-plan\/([^/]+)\/rewards\/([^/]+)\/claim$/);
  if (claimRewardMatch && request.method === "POST") {
    const reward = await growthService.claimReward(
      auth.userId,
      claimRewardMatch[1] as string,
      claimRewardMatch[2] as string,
    );
    return context.ok(reward, request.requestId as string);
  }

  // ===== Notification preferences routes =====
  if (request.path === "/api/v1/bodylog/notification-preferences" && request.method === "GET") {
    const preferences = await notificationService.getPreferences(auth.userId);
    return context.ok(preferences, request.requestId as string);
  }
  if (request.path === "/api/v1/bodylog/notification-preferences" && request.method === "PUT") {
    const body = requestBody(request);
    const preferences = await notificationService.updatePreferences(auth.userId, {
      enabledCategories: body.enabledCategories as NotificationCategory[] | undefined,
      quietHours: body.quietHours as { isEnabled: boolean; startHour: number; endHour: number } | undefined,
      mergeRequests: body.mergeRequests as boolean | undefined,
      leaderboardRankPush: body.leaderboardRankPush as boolean | undefined,
      marketingConsent: body.marketingConsent as boolean | undefined,
    });
    return context.ok(preferences, request.requestId as string);
  }
  if (request.path === "/api/v1/bodylog/push-devices" && request.method === "POST") {
    const body = requestBody(request);
    const device = await notificationService.registerDevice(
      auth.userId,
      body.deviceToken as string,
      body.platform as "ios" | "android",
      body.name as string | undefined,
    );
    return context.ok(device, request.requestId as string);
  }
  if (request.path === "/api/v1/bodylog/push-devices" && request.method === "GET") {
    const devices = await notificationService.listDevices(auth.userId);
    return context.ok(devices, request.requestId as string);
  }
  const deviceMatch = request.path.match(/^\/api\/v1\/bodylog\/push-devices\/([^/]+)$/);
  if (deviceMatch && request.method === "DELETE") {
    await notificationService.removeDevice(auth.userId, deviceMatch[1] as string);
    return context.ok({ removed: true }, request.requestId as string);
  }

  return undefined;
}
