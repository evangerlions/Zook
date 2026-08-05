import type { FrogSleepBuddyInvitationDomainDecisionRecord } from "../../../shared/types.ts";

/** Identifies the single decision row serialized by a buddy decline or cancel command. */
export interface FrogSleepBuddyInvitationDecisionSafetyKey {
  appId: string;
  invitationId: string;
  domain: FrogSleepBuddyInvitationDomainDecisionRecord["domain"];
}

/** Validates the exact domain-decision lock identity without touching participant slots. */
export function normalizeFrogSleepBuddyInvitationDecisionSafetyKey(
  key: FrogSleepBuddyInvitationDecisionSafetyKey,
): FrogSleepBuddyInvitationDecisionSafetyKey {
  const appId = key.appId?.trim();
  const invitationId = key.invitationId?.trim();
  if (!appId || !invitationId || (key.domain !== "sleep" && key.domain !== "focus")) {
    throw new Error("Invalid buddy invitation decision safety transaction key.");
  }
  return { appId, invitationId, domain: key.domain };
}

export function serializeFrogSleepBuddyInvitationDecisionSafetyKey(key: FrogSleepBuddyInvitationDecisionSafetyKey): string {
  return JSON.stringify([key.appId, key.invitationId, key.domain]);
}
