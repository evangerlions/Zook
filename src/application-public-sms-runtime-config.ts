import type { CreateApplicationOptions } from "./application-options.ts";

/// Resolves whether public SMS test bypass is allowed for the current runtime.
export function resolvePublicSmsTestBypass(options: CreateApplicationOptions): boolean {
  if (typeof options.publicSmsTestBypassEnabled === "boolean") {
    return options.publicSmsTestBypassEnabled;
  }
  const explicit = process.env.ZOOK_PUBLIC_SMS_TEST_BYPASS?.trim().toLowerCase();
  if (explicit === "true" || explicit === "1") return true;
  if (explicit === "false" || explicit === "0") return false;
  const appEnv = String(process.env.APP_ENV ?? "").trim().toLowerCase();
  const nodeEnv = String(process.env.NODE_ENV ?? "").trim().toLowerCase();
  return appEnv === "local" || appEnv === "development" || nodeEnv === "development";
}
