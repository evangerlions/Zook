import { adminPath, requestJson } from "./admin-api-client";
export type { CreditGrantRecord, CreditUserCandidate, CreditUserSearchField } from "../../../../src/modules/ai-novel/credits/admin-credit-search";
import type { CreditGrantRecord, CreditUserCandidate, CreditUserSearchField } from "../../../../src/modules/ai-novel/credits/admin-credit-search";

const root = "/apps/ai_novel/credit-grants";
export function searchCreditUsers(field: CreditUserSearchField, query: string) {
  return requestJson<{ tooMany: boolean; users: CreditUserCandidate[] }>(adminPath(`${root}/users?${new URLSearchParams({ field, query })}`));
}
export function listCreditGrants(offset: number) {
  return requestJson<{ items: CreditGrantRecord[]; hasMore: boolean; offset: number }>(adminPath(`${root}?${new URLSearchParams({ offset: String(offset) })}`));
}
export function grantCredits(body: { uid: string; points: number; idempotencyKey: string }) {
  return requestJson<{ uid: string; points: number }>(adminPath(root), { method: "POST", body });
}
