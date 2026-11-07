import type { CreditUserSearchField } from "../../lib/ai-novel-credit-admin-api";

export interface CreditSearchHistoryItem { field: CreditUserSearchField; query: string }
const limit = 10;
const key = (admin: string) => `zook.admin.credit-search-history.${encodeURIComponent(admin)}`;

export function addSearchHistory(history: CreditSearchHistoryItem[], field: CreditUserSearchField, value: string): CreditSearchHistoryItem[] {
  const query = value.trim();
  if (!query) return history;
  return [{ field, query }, ...history.filter(item => item.field !== field || item.query.toLowerCase() !== query.toLowerCase())].slice(0, limit);
}

export function loadSearchHistory(storage: Pick<Storage, "getItem"> | undefined, admin: string): CreditSearchHistoryItem[] {
  if (!storage || !admin) return [];
  try {
    const value: unknown = JSON.parse(storage.getItem(key(admin)) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is CreditSearchHistoryItem => item &&
      (item.field === "uid" || item.field === "phone" || item.field === "email") && typeof item.query === "string" && !!item.query.trim()).slice(0, limit);
  } catch { return []; }
}

export function saveSearchHistory(storage: Pick<Storage, "setItem"> | undefined, admin: string, history: CreditSearchHistoryItem[]): void {
  if (!storage || !admin) return;
  try { storage.setItem(key(admin), JSON.stringify(history)); } catch { /* Search remains usable when storage is unavailable. */ }
}

export function searchHistoryStorage(): Storage | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; }
}
