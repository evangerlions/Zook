import type { AiNovelBillingMembershipRecord } from "../../shared/types.ts";

/** Read-only effective state; never mutate persisted membership during admin reads. */
export function effectiveBillingMembership(record: AiNovelBillingMembershipRecord, now = Date.now()) {
  const expired = record.active && record.expiresAt !== null && Date.parse(record.expiresAt) <= now;
  return { ...record, active: record.active && !expired && !record.accountDeletedAt,
    state: expired ? "expired" as const : record.state };
}
