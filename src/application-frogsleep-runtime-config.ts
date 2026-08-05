import type { CreateApplicationOptions } from "./application-options.ts";

export function resolveFrogSleepEnabled(options: CreateApplicationOptions): boolean {
  if (typeof options.frogsleepEnabled === "boolean") {
    return options.frogsleepEnabled;
  }

  const explicit = process.env.FROGSLEEP_ENABLED?.trim().toLowerCase();
  if (explicit === "true" || explicit === "1") {
    return true;
  }
  if (explicit === "false" || explicit === "0") {
    return false;
  }

  const deploySlot = process.env.DEPLOY_SLOT?.trim().toLowerCase();
  return deploySlot === "dev" || deploySlot === "online";
}
