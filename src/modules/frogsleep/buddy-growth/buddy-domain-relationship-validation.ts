import type { FrogSleepBuddyDomainRelationshipRecord } from "../../../shared/types.ts";

const domains = new Set<FrogSleepBuddyDomainRelationshipRecord["domain"]>(["sleep", "focus"]);
const statuses = new Set<FrogSleepBuddyDomainRelationshipRecord["status"]>(["active", "paused", "revoked"]);

export type FrogSleepBuddyDomainRelationshipUpdate = {
  appId: string;
  id: string;
  expectedVersion: number;
  status: FrogSleepBuddyDomainRelationshipRecord["status"];
  pausedByUserIds: string[];
  revokedAt?: string;
  updatedAt: string;
};

function requiredIdentity(value: string, name: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new Error(`Invalid FrogSleep buddy domain relationship ${name}.`);
  }
  return value;
}

function requiredTimestamp(value: string, name: string): string {
  if (typeof value !== "string" || !value.trim() || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Invalid FrogSleep buddy domain relationship ${name}.`);
  }
  return value;
}

export function canonicalFrogSleepBuddyParticipants(firstUserId: string, secondUserId: string) {
  const first = requiredIdentity(firstUserId, "participant");
  const second = requiredIdentity(secondUserId, "participant");
  if (first === second) throw new Error("FrogSleep buddy domain relationship participants must be distinct.");
  return first < second ? { userIdLow: first, userIdHigh: second } : { userIdLow: second, userIdHigh: first };
}

export function normalizeFrogSleepBuddyDomainRelationship(
  record: FrogSleepBuddyDomainRelationshipRecord,
): FrogSleepBuddyDomainRelationshipRecord {
  requiredIdentity(record.id, "id");
  requiredIdentity(record.appId, "app");
  const participants = canonicalFrogSleepBuddyParticipants(record.userIdLow, record.userIdHigh);
  if (participants.userIdLow !== record.userIdLow) {
    throw new Error("FrogSleep buddy domain relationship participants must be canonical.");
  }
  if (!domains.has(record.domain)) throw new Error("Invalid FrogSleep buddy domain relationship domain.");
  if (!statuses.has(record.status)) throw new Error("Invalid FrogSleep buddy domain relationship status.");
  if (!Number.isInteger(record.version) || record.version < 1) {
    throw new Error("Invalid FrogSleep buddy domain relationship version.");
  }
  requiredTimestamp(record.createdAt, "created timestamp");
  requiredTimestamp(record.updatedAt, "updated timestamp");
  const pausedByUserIds = [...new Set(record.pausedByUserIds)].sort();
  if (pausedByUserIds.some((userId) => userId !== record.userIdLow && userId !== record.userIdHigh)) {
    throw new Error("Invalid FrogSleep buddy domain relationship paused participant.");
  }
  validateStatusFacts(record.status, pausedByUserIds, record.revokedAt);
  return structuredClone({ ...record, pausedByUserIds });
}

export function normalizeFrogSleepBuddyDomainRelationshipUpdate(
  input: FrogSleepBuddyDomainRelationshipUpdate,
): FrogSleepBuddyDomainRelationshipUpdate {
  requiredIdentity(input.id, "id");
  requiredIdentity(input.appId, "app");
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new Error("Invalid FrogSleep buddy domain relationship expected version.");
  }
  if (!statuses.has(input.status)) throw new Error("Invalid FrogSleep buddy domain relationship status.");
  requiredTimestamp(input.updatedAt, "updated timestamp");
  const pausedByUserIds = [...new Set(input.pausedByUserIds.map((userId) =>
    requiredIdentity(userId, "paused participant")))].sort();
  validateStatusFacts(input.status, pausedByUserIds, input.revokedAt);
  return structuredClone({ ...input, pausedByUserIds });
}

function validateStatusFacts(
  status: FrogSleepBuddyDomainRelationshipRecord["status"],
  pausedByUserIds: string[],
  revokedAt?: string,
) {
  if (status === "active" && (pausedByUserIds.length || revokedAt)) {
    throw new Error("Invalid active FrogSleep buddy domain relationship facts.");
  }
  if (status === "paused" && (!pausedByUserIds.length || revokedAt)) {
    throw new Error("Invalid paused FrogSleep buddy domain relationship facts.");
  }
  if (status === "revoked" && (pausedByUserIds.length || !revokedAt)) {
    throw new Error("Invalid revoked FrogSleep buddy domain relationship facts.");
  }
  if (revokedAt) requiredTimestamp(revokedAt, "revoked timestamp");
}
