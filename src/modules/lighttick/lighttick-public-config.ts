import { runtimeScope } from "./lighttick-runtime-scope.ts";
import type { AppConfigRecord } from "../../shared/types.ts";

export type LightTickRuntimeEnvironment = "local" | "dev" | "online";

export interface LightTickPublicConfiguration {
  app_id: "lighttick";
  runtime_scope: "core" | "full";
  enabled: boolean;
  environment: LightTickRuntimeEnvironment;
  configuration_version: string;
  minimum_client_versions: { ios: string; android: string };
  guest_session_ttl_seconds: number;
  features: {
    guest_sessions: boolean;
    account_upgrade: boolean;
    sync: boolean;
    notifications: boolean;
    ai_coach: boolean;
    conversational_planning: boolean;
  };
  privacy_policy_url: string;
  terms_of_service_url: string;
  support_url: string;
  grow_web_url?: string | null;
  updated_at: string;
}

const BUILTIN_UPDATED_AT = "2026-08-19T00:00:00.000Z";
const DEFAULT_GUEST_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_URLS = {
  privacyPolicyUrl: "https://api.zook.dev/api/v1/legal/privacy-policy",
  termsOfServiceUrl: "https://api.zook.dev/api/v1/legal/user-agreement",
  supportUrl: "https://api.zook.dev/support/lighttick",
};

type JsonObject = Record<string, unknown>;

function objectOf(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function boundedString(
  value: unknown,
  fallback: string,
  maximumLength = 128,
): string {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= maximumLength
    ? value.trim()
    : fallback;
}

function httpsUrl(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

export function growWebUrl(
  value: unknown,
  environment: LightTickRuntimeEnvironment,
): string | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/grow/" ||
      (url.protocol !== "https:" &&
        !(
          environment !== "online" &&
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        ))
    )
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function resolveLightTickEnvironment(
  env: Pick<NodeJS.ProcessEnv, "APP_ENV" | "NODE_ENV"> = process.env,
): LightTickRuntimeEnvironment {
  const appEnvironment = env.APP_ENV?.trim().toLowerCase();
  if (["online", "prod", "production"].includes(appEnvironment ?? ""))
    return "online";
  if (["dev", "development", "staging"].includes(appEnvironment ?? ""))
    return "dev";
  return env.NODE_ENV?.trim().toLowerCase() === "production"
    ? "online"
    : "local";
}

export function buildLightTickPublicConfiguration(
  runtimeEnabled: boolean,
  record?: AppConfigRecord,
  environment = resolveLightTickEnvironment(),
  planningEnabled = false,
): LightTickPublicConfiguration {
  let raw: JsonObject = {};
  if (record) {
    try {
      raw = objectOf(JSON.parse(record.configValue));
    } catch {
      raw = {};
    }
  }
  const configuredEnabled = raw.enabled === true;
  const enabled = runtimeEnabled && configuredEnabled;
  const versions = objectOf(raw.minimumClientVersions);
  const flags = objectOf(raw.featureFlags);
  const legal = objectOf(raw.legal);
  const settings = objectOf(raw.settings);
  const ttl = raw.guestSessionTtlSeconds;

  return {
    app_id: "lighttick",
    runtime_scope: runtimeScope(raw),
    enabled,
    environment,
    configuration_version: boundedString(
      raw.configurationVersion,
      record ? record.updatedAt : "builtin-1",
    ),
    minimum_client_versions: {
      ios: boundedString(versions.ios, "1.0.0", 64),
      android: boundedString(versions.android, "1.0.0", 64),
    },
    guest_session_ttl_seconds:
      Number.isInteger(ttl) &&
      (ttl as number) >= 3_600 &&
      (ttl as number) <= 7_776_000
        ? (ttl as number)
        : DEFAULT_GUEST_TTL_SECONDS,
    features: {
      guest_sessions: enabled && flags.guestSessions === true,
      account_upgrade: enabled && flags.accountUpgrade === true,
      sync: enabled && flags.offlineSync === true,
      notifications: enabled && flags.notifications === true,
      ai_coach: enabled && runtimeScope(raw) === "full" && flags.aiPlanning === true,
      conversational_planning:
        enabled && runtimeScope(raw) === "full" && planningEnabled && flags.conversationalPlanning === true,
    },
    privacy_policy_url: httpsUrl(
      legal.privacyPolicyUrl,
      DEFAULT_URLS.privacyPolicyUrl,
    ),
    terms_of_service_url: httpsUrl(
      legal.termsOfServiceUrl,
      DEFAULT_URLS.termsOfServiceUrl,
    ),
    support_url: httpsUrl(legal.supportUrl, DEFAULT_URLS.supportUrl),
    ...(enabled && growWebUrl(settings.growWebUrl, environment)
      ? { grow_web_url: growWebUrl(settings.growWebUrl, environment) }
      : {}),
    updated_at: record?.updatedAt ?? BUILTIN_UPDATED_AT,
  };
}
