import type { AccountRegion } from "../../shared/types.ts";

export type ClientAccountRegion = Exclude<AccountRegion, "UNKNOWN">;

export function parseClientAccountRegion(
  rawValue: string | undefined,
): ClientAccountRegion | undefined {
  const normalized = rawValue?.trim().toUpperCase();
  return normalized === "CN" || normalized === "GLOBAL"
    ? normalized
    : undefined;
}
