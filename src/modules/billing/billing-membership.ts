import type { MembershipInfo } from "../../generated/openapi/public-contracts.generated.ts";
import type { AiNovelBillingMembershipRecord } from "../../shared/types.ts";

export function billingMembershipInfo(record: AiNovelBillingMembershipRecord, now: Date): MembershipInfo {
  const expired = record.active && record.expiresAt !== null && Date.parse(record.expiresAt) <= now.getTime();
  return { active: record.active && !expired, state: expired ? "expired" : record.state,
    tier: record.tier, planKey: record.planKey, expiresAt: record.expiresAt,
    autoRenew: record.autoRenew, source: record.source, managementUrl: record.managementUrl };
}

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
