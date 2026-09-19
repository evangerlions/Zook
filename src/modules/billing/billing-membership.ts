import type { VipInfo } from "../../generated/openapi/public-contracts.generated.ts";

export function buildEmptyVipInfo(): VipInfo {
  return {
    active: false,
    state: "free",
    tier: null,
    planKey: null,
    expiresAt: null,
    autoRenew: null,
    source: null,
    managementUrl: null,
  };
}
