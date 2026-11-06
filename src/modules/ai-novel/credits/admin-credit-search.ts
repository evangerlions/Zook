import { ApplicationError } from "../../../shared/errors.ts";

export type CreditUserSearchField = "uid" | "phone" | "email";
export interface CreditUserCandidate { uid: string; phone: string | null; email: string | null }
export interface CreditGrantRecord { id: string; uid: string; points: number; adminUser: string; at: string }
export interface CreditUserSearchStore {
  searchUsers(field: CreditUserSearchField, term: string): Promise<CreditUserCandidate[]>;
}

/** The store reads at most eleven candidates; never expose a truncated list. */
export async function searchCreditUsers(store: CreditUserSearchStore, field: unknown, query: unknown) {
  if (field !== "uid" && field !== "phone" && field !== "email") {
    throw new ApplicationError(400, "REQ_INVALID_QUERY", "Invalid user search field.");
  }
  if (typeof query !== "string" || !query.trim() || query.trim().length > 160) {
    throw new ApplicationError(400, "REQ_INVALID_QUERY", "A search value is required.");
  }
  const users = await store.searchUsers(field, query.trim());
  return users.length > 10 ? { tooMany: true, users: [] } : { tooMany: false, users };
}
