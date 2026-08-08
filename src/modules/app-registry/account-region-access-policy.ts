import type { AccountRegion } from "../../shared/types.ts";
import { parseClientAccountRegion } from "./account-region.ts";

export type AuthoritativeProductPlatform = "android" | "web";

export interface AccountRegionAccessPolicy {
  platform: AuthoritativeProductPlatform;
  productRegion: Exclude<AccountRegion, "UNKNOWN">;
}

export function resolveAccountRegionAccessPolicy(
  platformHeader: string | undefined,
  regionHeader: string | undefined,
): AccountRegionAccessPolicy | undefined {
  const platform = platformHeader?.trim().toLowerCase();
  if (platform !== "android" && platform !== "web") {
    return undefined;
  }

  const productRegion = parseClientAccountRegion(regionHeader);
  if (!productRegion) {
    return undefined;
  }

  return { platform, productRegion };
}
