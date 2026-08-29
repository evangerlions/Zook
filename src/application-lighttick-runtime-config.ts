import type { CreateApplicationOptions } from "./application-options.ts";

export function resolveLightTickEnabled(options: CreateApplicationOptions): boolean {
  if (typeof options.lighttickEnabled === "boolean") {
    return options.lighttickEnabled;
  }

  const explicit = process.env.LIGHTTICK_ENABLED?.trim().toLowerCase();
  return explicit === "true" || explicit === "1";
}
