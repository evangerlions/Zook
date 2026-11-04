import type { MembershipInfo } from "../../generated/openapi/public-contracts.generated.ts";

export function buildEmptyMembershipInfo(): MembershipInfo {
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
