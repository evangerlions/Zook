import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { conflict } from "../../../shared/errors.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";

type Domain = "sleep" | "focus";

/** Checks both canonical slots and existing compatibility relationships without making another relationship truth. */
export async function assertInvitationSlotsAvailable(database: ApplicationDatabase, domain: Domain, users: string[]) {
  for (const userId of users) {
    const slot = await database.findFrogSleepBuddyDomainSlot(FROGSLEEP_APP_ID, userId, domain);
    if (slot && slot.state !== "available") occupied();
    for (const status of domain === "sleep" ? ["active", "paused"] : ["accepted", "active", "paused"]) {
      for (const field of ["ownerUserId", "partnerUserId"] as const) {
        const existing = await database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID,
          kind: `${domain}_relationship`, [field]: userId, status, limit: 1 });
        if (existing.length) occupied();
      }
    }
  }
}

export async function lockLegacyInvitationSlots(database: ApplicationDatabase, invitationId: string,
  domain: Domain, inviterUserId: string, inviteeUserId: string) {
  const users = [inviterUserId, inviteeUserId];
  await database.lockFrogSleepBuddyDomainSlots(users.map(userId => ({ appId: FROGSLEEP_APP_ID, userId, domain })));
  const invite = await database.findFrogSleepEntity(`${domain}_invite`, FROGSLEEP_APP_ID, invitationId);
  if (invite?.status !== "pending") conflict("REQ_INVALID_BODY", "Buddy invitation domain is already terminal.");
  await assertInvitationSlotsAvailable(database, domain, users);
}

function occupied(): never { return conflict("BUDDY_DOMAIN_SLOT_OCCUPIED", "Buddy domain slot is occupied."); }
