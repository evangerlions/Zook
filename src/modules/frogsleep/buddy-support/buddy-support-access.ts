import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { findBuddyRelationship, currentBuddyRelationships } from "../buddy-growth/buddy-relationship-facts.ts";
import { isBuddyPairBlocked } from "../buddy-growth/buddy-safety.ts";
import { assertBuddyDataAuthorized } from "../buddy-growth/buddy-protected-access.ts";
import { appID, unavailable, failure } from "./buddy-support-validation.ts";
import type { SupportContext, SupportNote } from "./buddy-support.types.ts";

/** Reauthorizes support membership independently of shared data categories. */
export class BuddySupportAccess {
  constructor(private readonly database: ApplicationDatabase) {}
  async relationship(actor: string, id: string, paused = false): Promise<FrogSleepEntityRecord> {
    const row = await findBuddyRelationship(this.database, id);
    const statuses = paused ? ["active", "accepted", "paused"] : ["active", "accepted"];
    if (!row?.ownerUserId || !row.partnerUserId || !statuses.includes(row.status ?? "")
      || ![row.ownerUserId, row.partnerUserId].includes(actor)) unavailable();
    if (await isBuddyPairBlocked(this.database, row.ownerUserId!, row.partnerUserId!)) unavailable();
    for (const user of [row.ownerUserId!, row.partnerUserId!]) {
      if ((await this.database.findAppUser(appID, user))?.status !== "ACTIVE") unavailable();
    }
    return row;
  }
  async relationships(actor: string, paused = false) {
    const result: FrogSleepEntityRecord[] = [];
    for (const row of await currentBuddyRelationships(this.database, actor)) {
      try { result.push(await this.relationship(actor, row.id, paused)); }
      catch (error) { if ((error as { code?: string }).code !== "BUDDY_SUPPORT_UNAVAILABLE") throw error; }
    }
    return result;
  }
  keys(row: FrogSleepEntityRecord) {
    return (["sleep", "focus"] as const).flatMap(domain => [row.ownerUserId!, row.partnerUserId!]
      .map(userId => ({ appId: appID, userId, domain })));
  }
  other(row: FrogSleepEntityRecord, actor: string) { return row.ownerUserId === actor ? row.partnerUserId! : row.ownerUserId!; }
  domain(row: FrogSleepEntityRecord) { return row.kind === "sleep_relationship" ? "sleep" as const : "focus" as const; }
  async context(actor: string, relationship: string, value: SupportContext | null) {
    if (!value) return;
    const record = await this.database.findFrogSleepEntity(value.type, appID, value.id);
    if (!record || record.relationshipId !== relationship) unavailable();
    if (value.type === "buddy_share" && String(record.payload.expires_at) <= new Date().toISOString()) unavailable();
    try { await assertBuddyDataAuthorized(this.database, actor, relationship,
      value.type === "buddy_share" ? "daily_summary" : "shared_activity"); } catch { unavailable(); }
  }
  async readable(actor: string, value: SupportNote) {
    if (![value.sender_id, value.recipient_id].includes(actor) || value.expires_at <= new Date().toISOString()) unavailable();
    await this.relationship(actor, value.relationship_id);
  }
}

export async function assertLegacySupportAllowed(database: ApplicationDatabase, relationship: string) {
  if (await database.getBuddySupportRepository().isEnrolled(appID, relationship)) failure("BUDDY_SUPPORT_UPDATE_REQUIRED");
}
