import assert from "node:assert/strict";
import test from "node:test";
import { createCreditsMembershipReader } from "../../src/modules/ai-novel/credits/credits-membership-reader.ts";
import type { AiNovelBillingService } from "../../src/services/ainovel-billing.service.ts";
import type { AiNovelBillingMembershipRecord } from "../../src/shared/types/ainovel-billing.ts";

const record: AiNovelBillingMembershipRecord = { appId: "ai_novel", userId: "u", active: true, state: "active", tier: "plus",
  planKey: "plus_monthly", expiresAt: "2099-01-01T00:00:00Z", autoRenew: true, source: "app_store",
  managementUrl: null, lastSyncedAt: "2026-10-06T00:00:00Z", accountDeletedAt: null };
function reader(value?: AiNovelBillingMembershipRecord) {
  return createCreditsMembershipReader({ getMembershipRecord: async () => value } as AiNovelBillingService);
}
test("single internal membership snapshot provides trusted anchor and revision", async () => {
  assert.deepEqual(await reader({ ...record, creditWindowAnchorAt: "2026-10-06T00:00:00Z" })("u"), {
    tier: "plus", anchorAt: "2026-10-06T00:00:00Z", expiresAt: record.expiresAt, observedAt: record.lastSyncedAt,
  });
});
test("missing trusted activation timestamps fail closed, never invent lookup time", async () => {
  await assert.rejects(reader(record)("u"), { code: "AINOVEL_CREDITS_MEMBERSHIP_ANCHOR_UNAVAILABLE" });
  await assert.rejects(reader({ ...record, creditWindowAnchorAt: "invalid" })("u"));
});
test("expired, deleted and absent memberships get Free rather than paid quota", async () => {
  for (const membership of [undefined, { ...record, expiresAt: "2020-01-01T00:00:00Z" }, { ...record, accountDeletedAt: "2026-10-06T00:00:00Z" }]) {
    assert.equal((await reader(membership)("u")).tier, "free");
  }
});
