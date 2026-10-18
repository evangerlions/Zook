import type { FrogSleepEntityRecord } from "../shared/types.ts";
import { focusSessionKey, type FrogSleepFocusSessionWriteResult } from "../shared/frogsleep-focus-session.ts";

export function assertUniqueFocusSession(record: FrogSleepEntityRecord, records: FrogSleepEntityRecord[]): void {
  const key = focusSessionKey(record);
  if (key && records.some(item => focusSessionKey(item) === key)) throw Object.assign(new Error("Duplicate focus client session ID."), { code: "23505" });
}

export function upsertMemoryFocusSession(record: FrogSleepEntityRecord, records: FrogSleepEntityRecord[]): FrogSleepFocusSessionWriteResult {
  const key = focusSessionKey(record);
  if (!key) throw new Error("Atomic focus writes require an owner and valid client session ID.");
  const existing = records.find(item => focusSessionKey(item) === key);
  if (!existing) { records.push(structuredClone(record)); return { record: structuredClone(record), inserted: true }; }
  if (!record.payload._report_fingerprint || existing.payload._report_fingerprint !== record.payload._report_fingerprint) {
    Object.assign(existing, structuredClone(record), { id: existing.id, createdAt: existing.createdAt });
  }
  return { record: structuredClone(existing), inserted: false };
}
