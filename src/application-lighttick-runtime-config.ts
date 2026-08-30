import type { CreateApplicationOptions } from "./application-options.ts";

export function resolveLightTickEnabled(options: CreateApplicationOptions): boolean {
  if (typeof options.lighttickEnabled === "boolean") {
    return options.lighttickEnabled;
  }

  const explicit = process.env.LIGHTTICK_ENABLED?.trim().toLowerCase();
  return explicit === "true" || explicit === "1";
}

export function resolveLightTickSeedEnabled(
  options: CreateApplicationOptions,
  runtimeEnabled: boolean,
): boolean {
  if (typeof options.lighttickSeedEnabled === "boolean") return options.lighttickSeedEnabled;
  const explicit = process.env.LIGHTTICK_SEED_ENABLED?.trim().toLowerCase();
  if (explicit !== undefined && explicit !== "") return explicit === "true" || explicit === "1";
  return runtimeEnabled;
}
