import type { FrogSleepBuddyDomainSlotRecord } from "../../../shared/types.ts";

/** Identifies the user-domain slot locked by a buddy command transaction. */
export interface FrogSleepBuddyCommandSlotKey {
  appId: string;
  userId: string;
  domain: FrogSleepBuddyDomainSlotRecord["domain"];
}

const validDomains = new Set<FrogSleepBuddyCommandSlotKey["domain"]>(["sleep", "focus"]);

/** Validates, trims, deduplicates and deterministically orders buddy command slot keys. */
export function normalizeFrogSleepBuddyCommandSlotKeys(
  keys: FrogSleepBuddyCommandSlotKey[],
): FrogSleepBuddyCommandSlotKey[] {
  if (keys.length === 0) throw new Error("Buddy command transaction slot keys are required.");
  const unique = new Map<string, FrogSleepBuddyCommandSlotKey>();
  for (const key of keys) {
    const normalized = normalizeKey(key);
    unique.set(serializeFrogSleepBuddyCommandSlotKey(normalized), normalized);
  }
  return [...unique.values()].sort(compareKeys);
}

export function serializeFrogSleepBuddyCommandSlotKey(key: FrogSleepBuddyCommandSlotKey): string {
  return JSON.stringify([key.appId, key.userId, key.domain]);
}

function normalizeKey(key: FrogSleepBuddyCommandSlotKey): FrogSleepBuddyCommandSlotKey {
  const appId = key.appId?.trim();
  const userId = key.userId?.trim();
  if (!appId || !userId || !validDomains.has(key.domain)) {
    throw new Error("Invalid buddy command transaction slot key.");
  }
  return { appId, userId, domain: key.domain };
}

function compareKeys(left: FrogSleepBuddyCommandSlotKey, right: FrogSleepBuddyCommandSlotKey): number {
  if (left.appId !== right.appId) return left.appId < right.appId ? -1 : 1;
  if (left.userId !== right.userId) return left.userId < right.userId ? -1 : 1;
  return left.domain === right.domain ? 0 : left.domain < right.domain ? -1 : 1;
}
