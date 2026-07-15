import type { FrogSleepBuddyDomainSlotRecord } from "../../../shared/types.ts";

const slotDomains = new Set<FrogSleepBuddyDomainSlotRecord["domain"]>(["sleep", "focus"]);
const slotStates = new Set<FrogSleepBuddyDomainSlotRecord["state"]>(["available", "occupied"]);

/** Validates the runtime values that PostgreSQL constrains for buddy domain slots. */
export function assertValidFrogSleepBuddyDomainSlot(input: {
  domain: unknown;
  state: unknown;
  relationshipId?: unknown;
}): void {
  if (!slotDomains.has(input.domain as FrogSleepBuddyDomainSlotRecord["domain"])) {
    throw new Error("Invalid FrogSleep buddy domain.");
  }
  if (!slotStates.has(input.state as FrogSleepBuddyDomainSlotRecord["state"])) {
    throw new Error("Invalid FrogSleep buddy domain slot state.");
  }
  if (input.state === "available" && input.relationshipId !== undefined && input.relationshipId !== null) {
    throw new Error("Invalid FrogSleep buddy domain slot relationship.");
  }
  if (input.state === "occupied" && (typeof input.relationshipId !== "string" || !input.relationshipId.trim())) {
    throw new Error("Invalid FrogSleep buddy domain slot relationship.");
  }
}
