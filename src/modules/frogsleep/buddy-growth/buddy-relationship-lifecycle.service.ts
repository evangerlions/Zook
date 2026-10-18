import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { badRequest, conflict } from "../../../shared/errors.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { buddyRelationshipSlotKeys, currentBuddyRelationships, requireBuddyRelationship } from "./buddy-relationship-facts.ts";
import { closeBuddySharedSessions, revokeBuddyRelationship } from "./buddy-relationship-cleanup.ts";
import { assertBuddyPairNotBlocked } from "./buddy-safety.ts";

export type BuddyRelationshipAction = "pause" | "resume" | "revoke" | "mute" | "unmute";

/** Serializes relationship lifecycle commands against authoritative per-domain facts. */
export class BuddyRelationshipLifecycleService {
  constructor(private readonly database: ApplicationDatabase) {}

  async list(actor: string) {
    const rows = await currentBuddyRelationships(this.database, actor);
    return { relationships: await Promise.all(rows.map((row) => this.payload(actor, row))) };
  }

  async detail(actor: string, id: string) {
    return await this.payload(actor, await requireBuddyRelationship(this.database, actor, id));
  }

  async execute(actor: string, id: string, action: BuddyRelationshipAction, expectedVersion?: number) {
    if (!["pause", "resume", "revoke", "mute", "unmute"].includes(action)) badRequest("REQ_INVALID_BODY", "Invalid relationship action.");
    if (expectedVersion !== undefined && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) {
      badRequest("REQ_INVALID_BODY", "Invalid relationship version.");
    }
    const row = await requireBuddyRelationship(this.database, actor, id);
    return await this.database.withFrogSleepBuddyCommandTransaction(buddyRelationshipSlotKeys(row), async () => {
      const current = await requireBuddyRelationship(this.database, actor, id);
      await this.mutate(actor, current, action, expectedVersion);
      return await this.detail(actor, id);
    });
  }

  private async mutate(actor: string, row: FrogSleepEntityRecord, action: BuddyRelationshipAction, expected?: number) {
    const paused = pausedParticipants(row);
    if (row.status === "revoked") {
      if (action === "revoke") { await revokeBuddyRelationship(this.database, row); return; }
      conflict("REQ_INVALID_BODY", "Terminated buddy relationships cannot be restored.");
    }
    await assertBuddyPairNotBlocked(this.database, row.ownerUserId!, row.partnerUserId!);
    if (action === "pause" && paused.includes(actor) || action === "resume" && !paused.includes(actor)) return;
    if (expected !== undefined && expected !== Number(row.payload.version ?? 1)) conflict("REQ_INVALID_BODY", "Buddy relationship version conflict.");
    if (action === "revoke") { await revokeBuddyRelationship(this.database, row); return; }
    if (action === "mute" || action === "unmute") { await this.setMuted(actor, row.id, action === "mute"); return; }
    const next = action === "pause" ? [...new Set([...paused, actor])].sort() : paused.filter((value) => value !== actor);
    await this.setPaused(row, next);
    if (action === "pause") await closeBuddySharedSessions(this.database, row.id);
  }

  private async setPaused(row: FrogSleepEntityRecord, paused: string[]) {
    const status = paused.length ? "paused" : "active";
    if (row.payload.canonical) {
      const updated = await this.database.compareAndUpdateFrogSleepBuddyDomainRelationship({ appId: FROGSLEEP_APP_ID,
        id: row.id, expectedVersion: Number(row.payload.version), status, pausedByUserIds: paused,
        updatedAt: new Date().toISOString() });
      if (!updated) conflict("REQ_INVALID_BODY", "Buddy relationship version conflict.");
    } else {
      await this.database.updateFrogSleepEntity(row.kind, FROGSLEEP_APP_ID, row.id,
        { status: status === "active" && row.kind === "focus_relationship" ? "accepted" : status,
          payload: { ...row.payload, version: Number(row.payload.version ?? 1) + 1, paused_by_user_ids: paused } });
    }
  }

  private async setMuted(actor: string, id: string, muted: boolean) {
    const existing = await buddyRelationshipMute(this.database, actor, id);
    if (existing?.payload.muted === muted) return;
    const now = new Date().toISOString();
    if (existing) await this.database.updateFrogSleepEntity("guardianship_preference", FROGSLEEP_APP_ID,
      existing.id, { payload: { muted } });
    else await this.database.insertFrogSleepEntity({ id: `buddy_mute_${id}_${actor}`, appId: FROGSLEEP_APP_ID,
      kind: "guardianship_preference", ownerUserId: actor, relationshipId: id,
      status: "buddy_relationship_notifications", payload: { muted }, createdAt: now, updatedAt: now });
  }

  private async payload(actor: string, row: FrogSleepEntityRecord) {
    const preference = await buddyRelationshipMute(this.database, actor, row.id);
    return { id: row.id, viewer_user_id: actor,
      partner_user_id: row.ownerUserId === actor ? row.partnerUserId : row.ownerUserId,
      domain: row.kind === "sleep_relationship" ? "sleep" : "focus", status: row.status === "accepted" ? "active" : row.status,
      version: Number(row.payload.version ?? 1), paused_by_user_ids: pausedParticipants(row),
      is_muted: preference?.payload.muted === true };
  }
}

function pausedParticipants(row: FrogSleepEntityRecord): string[] {
  return Array.isArray(row.payload.paused_by_user_ids) ? row.payload.paused_by_user_ids.map(String)
    : row.status === "paused" ? [row.ownerUserId!, row.partnerUserId!] : [];
}

/** Reads only the recipient's per-relationship silence preference. */
export async function buddyRelationshipMute(database: ApplicationDatabase, actor: string, id: string) {
  return (await database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID, kind: "guardianship_preference",
    ownerUserId: actor, relationshipId: id, status: "buddy_relationship_notifications", limit: 1 }))[0];
}
