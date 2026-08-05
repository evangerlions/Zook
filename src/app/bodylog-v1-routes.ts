import type { BodyLogProfileService } from "../modules/bodylog/bodylog-profile.service.ts";
import type { BodyLogSocialService } from "../modules/bodylog/bodylog-social.service.ts";
import type { BodyLogLeaderboardService } from "../modules/bodylog/bodylog-leaderboard.service.ts";
import type { BodyLogInvitationService } from "../modules/bodylog/bodylog-invitation.service.ts";
import type { BodyLogChallengeService } from "../modules/bodylog/bodylog-challenge.service.ts";
import { BODYLOG_APP_ID } from "../modules/bodylog/bodylog-profile.types.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

const BODYLOG_PROFILE_PATH = "/api/v1/bodylog/profile";

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
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (!request.path.startsWith("/api/v1/bodylog/")) {
    return undefined;
  }

  const auth = await context.authenticateProductRequest(request, BODYLOG_APP_ID);
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
    return context.ok(
      await invitationService.create(auth.userId, requestBody(request).installId),
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
  return undefined;
}
