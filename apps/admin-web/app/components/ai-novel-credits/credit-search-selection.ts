import type { CreditUserCandidate } from "../../lib/ai-novel-credit-admin-api";

export function selectedUserForSearch(result: { users: CreditUserCandidate[]; tooMany: boolean }): string | undefined {
  return !result.tooMany && result.users.length === 1 ? result.users[0].uid : undefined;
}
