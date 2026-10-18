import type { FrogSleepEntityRecord } from "./types.ts";

/** Result of one owner-scoped atomic focus write; only inserts trigger initial derived work. */
export interface FrogSleepFocusSessionWriteResult {
  record: FrogSleepEntityRecord;
  inserted: boolean;
}

export function focusSessionClientId(record: FrogSleepEntityRecord): string | undefined {
  const value = record.payload.client_session_id;
  if (record.kind !== "focus_session" || !record.ownerUserId || record.deletedAt ||
      typeof value !== "string" || !value.trim() || Array.from(value).length > 128) return undefined;
  return value;
}

export function focusSessionKey(record: FrogSleepEntityRecord): string | undefined {
  const id = focusSessionClientId(record);
  return id === undefined ? undefined : JSON.stringify([record.appId, record.ownerUserId, id]);
}
