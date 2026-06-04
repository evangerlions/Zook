import type { ResolvedAdminBasicAuth } from "./app/backend-route-context.ts";
import type { CreateApplicationOptions } from "./application-options.ts";
import { createOpaqueToken } from "./shared/utils.ts";

export function resolveAdminBasicAuth(
  options: CreateApplicationOptions,
): ResolvedAdminBasicAuth | null {
  const username =
    options.adminBasicAuth?.username ??
    process.env.ADMIN_BASIC_AUTH_USERNAME ??
    "";
  const password =
    options.adminBasicAuth?.password ??
    process.env.ADMIN_BASIC_AUTH_PASSWORD ??
    "";

  if (!username && !password) {
    return null;
  }

  if (!username || !password) {
    throw new Error(
      "ADMIN_BASIC_AUTH_USERNAME and ADMIN_BASIC_AUTH_PASSWORD must be configured together.",
    );
  }

  return {
    username,
    password,
  };
}

export function resolveSecureRefreshCookie(
  options: CreateApplicationOptions,
): boolean {
  if (typeof options.secureRefreshCookie === "boolean") {
    return options.secureRefreshCookie;
  }

  const sameSite = resolveRefreshCookieSameSite(options);
  if (sameSite === "None") {
    return true;
  }

  return options.serviceName === "api" || process.env.NODE_ENV === "production";
}

export function resolveRefreshCookieSameSite(
  options: CreateApplicationOptions,
): "Lax" | "None" | "Strict" {
  const runtimeServiceName = options.serviceName ?? "api";
  const configured =
    options.refreshCookieSameSite ?? process.env.AUTH_REFRESH_COOKIE_SAMESITE;
  if (configured) {
    const normalized = configured.trim().toLowerCase();
    if (normalized === "lax") {
      return "Lax";
    }
    if (normalized === "none") {
      return "None";
    }
    if (normalized === "strict") {
      return "Strict";
    }

    throw new Error(
      "AUTH_REFRESH_COOKIE_SAMESITE must be one of: Lax, None, Strict.",
    );
  }

  if (runtimeServiceName === "api" || process.env.NODE_ENV === "production") {
    return "None";
  }

  return "Lax";
}

export function resolveAccessTokenSecrets(options: CreateApplicationOptions): {
  current: string;
  previous: string[];
} {
  const current =
    options.accessTokenSecret?.trim() ||
    process.env.AUTH_ACCESS_TOKEN_SECRET?.trim() ||
    "";
  const previous =
    options.accessTokenPreviousSecrets ??
    process.env.AUTH_ACCESS_TOKEN_PREVIOUS_SECRETS?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ??
    [];

  if (current) {
    return {
      current,
      previous,
    };
  }

  if (options.serviceName === "api") {
    throw new Error(
      "AUTH_ACCESS_TOKEN_SECRET must be configured before starting the API service.",
    );
  }

  return {
    current: createOpaqueToken("atk_secret"),
    previous: previous.filter(Boolean),
  };
}
