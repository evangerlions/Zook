import type { AuthContext, HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import {
  assertFrogSleepAuth,
  FROGSLEEP_APP_ID,
} from "../modules/frogsleep/frogsleep-app.ts";
import { badRequest } from "../shared/errors.ts";

export const FROGSLEEP_REFRESH_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000;

export async function getFrogSleepInviteLinks(context: BackendRouteContext) {
  const config = await context.database.findAppConfig(FROGSLEEP_APP_ID, "admin.delivery_config");
  if (!config) {
    return {
      sleepBuddyBaseUrl: "frogsleep://sleep-buddy-invite",
      focusBuddyBaseUrl: "frogsleep://focus-invite",
      buddyHandoffBaseUrl: process.env.FROGSLEEP_BUDDY_HANDOFF_BASE_URL
        ?? "https://app.youwoai.net/frogsleep/buddy-invitation",
    };
  }
  try {
    const parsed = JSON.parse(config.configValue) as {
      inviteLinks?: {
        sleepBuddyBaseUrl?: string;
        focusBuddyBaseUrl?: string;
        buddyHandoffBaseUrl?: string;
      };
    };
    return {
      sleepBuddyBaseUrl: parsed.inviteLinks?.sleepBuddyBaseUrl || "frogsleep://sleep-buddy-invite",
      focusBuddyBaseUrl: parsed.inviteLinks?.focusBuddyBaseUrl || "frogsleep://focus-invite",
      buddyHandoffBaseUrl: parsed.inviteLinks?.buddyHandoffBaseUrl
        || process.env.FROGSLEEP_BUDDY_HANDOFF_BASE_URL
        || "https://app.youwoai.net/frogsleep/buddy-invitation",
    };
  } catch {
    return {
      sleepBuddyBaseUrl: "frogsleep://sleep-buddy-invite",
      focusBuddyBaseUrl: "frogsleep://focus-invite",
      buddyHandoffBaseUrl: process.env.FROGSLEEP_BUDDY_HANDOFF_BASE_URL
        ?? "https://app.youwoai.net/frogsleep/buddy-invitation",
    };
  }
}

export function redirectTo(location: string, requestId: string): HttpResponse<unknown> {
  return {
    statusCode: 302,
    headers: {
      Location: location,
    },
    body: {
      code: "OK",
      message: "Redirect",
      data: { location },
      requestId,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function frogSleepOk(
  context: BackendRouteContext,
  payload: unknown,
  requestId: string,
  headers?: Record<string, string>,
): HttpResponse<unknown> {
  const response = context.ok(payload, requestId, headers) as HttpResponse<unknown>;
  if (isRecord(payload)) {
    response.body = {
      ...response.body,
      ...payload,
    } as typeof response.body;
  }
  return response;
}

export function dualResourcePayload(key: string, value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return { [key]: value };
  }
  return {
    ...value,
    [key]: value,
  };
}

export async function authenticateFrogSleepRequest(
  context: BackendRouteContext,
  request: HttpRequest,
): Promise<AuthContext> {
  const auth = await context.authenticateProductRequest(request, FROGSLEEP_APP_ID);
  return assertFrogSleepAuth(auth);
}

export function asBody(request: HttpRequest): Record<string, unknown> {
  return request.body && typeof request.body === "object" && !Array.isArray(request.body)
    ? request.body as Record<string, unknown>
    : {};
}

export function stringField(body: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

export function requireStringField(body: Record<string, unknown>, ...keys: string[]): string {
  const value = stringField(body, ...keys);
  if (!value) {
    badRequest("REQ_INVALID_BODY", `Missing required field: ${keys[0]}`);
  }
  return value;
}

export async function toFrogSleepAuthPayload(
  context: BackendRouteContext,
  session: {
    userId: string;
    appId: string;
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  },
) {
  const user = await context.userService.getProfile(session.userId);
  const accessTokenExpiresAt = new Date(Date.now() + session.expiresIn * 1000).toISOString();
  return {
    access_token: session.accessToken,
    access_token_expires_at: accessTokenExpiresAt,
    expires_in: session.expiresIn,
    refresh_token: session.refreshToken,
    refresh_token_expires_at: new Date(Date.now() + FROGSLEEP_REFRESH_TOKEN_TTL_MS).toISOString(),
    user_id: session.userId,
    app_id: session.appId,
    user,
  };
}

export async function toFrogSleepMePayload(
  context: BackendRouteContext,
  userId: string,
) {
  const user = await context.userService.getProfile(userId);
  return {
    app_id: FROGSLEEP_APP_ID,
    user_id: userId,
    verified_email: user.email ?? undefined,
    display_name: user.name,
    email_verified: Boolean(user.email),
    user,
  };
}
