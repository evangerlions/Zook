import { forbidden } from "../../shared/errors.ts";
import type { AuthContext, HttpRequest } from "../../shared/types.ts";

export const FROGSLEEP_APP_ID = "frogsleep";

export function withFrogSleepAppId<T extends Record<string, unknown>>(body: T): T & { appId: string } {
  return {
    ...body,
    appId: FROGSLEEP_APP_ID,
  };
}

export function assertFrogSleepAuth(auth: AuthContext): AuthContext {
  if (auth.appId !== FROGSLEEP_APP_ID) {
    forbidden(
      "AUTH_APP_SCOPE_MISMATCH",
      "FrogSleep routes require a FrogSleep access token.",
    );
  }
  return auth;
}

export function attachFrogSleepBodyAppId(request: HttpRequest): HttpRequest {
  if (request.body && typeof request.body === "object" && !Array.isArray(request.body)) {
    request.body = withFrogSleepAppId(request.body as Record<string, unknown>);
    return request;
  }

  request.body = { appId: FROGSLEEP_APP_ID };
  return request;
}
