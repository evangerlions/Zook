import type { AiNovelBillingService } from "../../../services/ainovel-billing.service.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import type { CreditsMembership } from "./ai-novel-credits-model.ts";

export function createCreditsMembershipReader(billing: AiNovelBillingService) {
  return async (userId: string): Promise<CreditsMembership> => {
    const record = await billing.getMembershipRecord(userId);
    if (!record || record.accountDeletedAt || !record.active || !record.tier ||
      (record.expiresAt !== null && Date.parse(record.expiresAt) <= Date.now())) return { tier: "free", observedAt: record?.lastSyncedAt };
    if (!record?.creditWindowAnchorAt || !Number.isFinite(Date.parse(record.creditWindowAnchorAt))) {
      throw new ApplicationError(503, "AINOVEL_CREDITS_MEMBERSHIP_ANCHOR_UNAVAILABLE", "Membership purchase start must be synchronized before calculating credits.");
    }
    return { tier: record.tier, anchorAt: record.creditWindowAnchorAt, expiresAt: record.expiresAt, observedAt: record.lastSyncedAt };
  };
}
