import type { BodyLogProfileService } from "../modules/bodylog/bodylog-profile.service.ts";
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
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (request.path !== BODYLOG_PROFILE_PATH) {
    return undefined;
  }

  const auth = await context.authenticateProductRequest(request, BODYLOG_APP_ID);
  if (request.method === "GET") {
    const profile = await profileService.getOrCreate(auth.userId);
    return context.ok(profile, request.requestId as string);
  }
  if (request.method === "PUT") {
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
  return undefined;
}
