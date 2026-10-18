import { createHash } from "node:crypto";
import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { buddyRelationshipSlotKeys, findBuddyRelationship } from "../buddy-growth/buddy-relationship-facts.ts";
import { assertBuddyDataAuthorized } from "../buddy-growth/buddy-protected-access.ts";
import { focusSessionsOverlap, otherFocusUserId, relationshipsForFocusUser } from "./focus-buddy-records.ts";
import { unlockFocusMilestone } from "./focus-buddy-achievements.ts";

/** Derives one consented shared moment per completed session pair without gating private persistence. */
export async function recordFocusSharedMoment(database: ApplicationDatabase, session: FrogSleepEntityRecord) {
  if (session.status !== "completed" || !session.ownerUserId) return;
  const row = (await relationshipsForFocusUser(database, session.ownerUserId, ["accepted"]))[0];
  if (!row) return;
  await database.withFrogSleepBuddyCommandTransaction(buddyRelationshipSlotKeys(row), async () => {
    const current = await findBuddyRelationship(database, row.id);
    if (!current || !["active", "accepted"].includes(current.status ?? "")) return;
    const partner = otherFocusUserId(row, session.ownerUserId!);
    await assertBuddyDataAuthorized(database, session.ownerUserId!, row.id, "shared_activity");
    await assertBuddyDataAuthorized(database, partner, row.id, "shared_activity");
    const candidates = await database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID, kind: "focus_session", ownerUserId: partner, limit: 100 });
    for (const buddy of candidates.filter(value => value.status === "completed" && focusSessionsOverlap(session, value))) {
      await saveMoment(database, row, session, buddy);
    }
  });
}

async function saveMoment(database: ApplicationDatabase, row: FrogSleepEntityRecord, session: FrogSleepEntityRecord, buddy: FrogSleepEntityRecord) {
  const pair = [session.id, buddy.id].sort();
  const id = `focus_shared_moment_${createHash("sha256").update(JSON.stringify([FROGSLEEP_APP_ID, row.id, ...pair])).digest("hex")}`;
  if (await database.findFrogSleepEntity("focus_shared_moment", FROGSLEEP_APP_ID, id)) return;
  const existing = await database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID, kind: "focus_shared_moment", relationshipId: row.id, limit: 500 });
  if (existing.some(value => JSON.stringify([value.payload.session_id, value.payload.buddy_session_id].sort()) === JSON.stringify(pair))) return;
  const timestamp = new Date().toISOString();
  await database.insertFrogSleepEntity({ id, appId: FROGSLEEP_APP_ID, kind: "focus_shared_moment",
    ownerUserId: session.ownerUserId, partnerUserId: buddy.ownerUserId, relationshipId: row.id,
    startsAt: session.startsAt, endsAt: session.endsAt, status: "detected",
    payload: { session_id: session.id, buddy_session_id: buddy.id,
      room_id: session.payload.room_id ?? session.payload.room ?? buddy.payload.room_id ?? buddy.payload.room,
      room_ids: [session.payload.room_id ?? session.payload.room, buddy.payload.room_id ?? buddy.payload.room].filter(Boolean) },
    createdAt: timestamp, updatedAt: timestamp });
  await unlockFocusMilestone(database, session.ownerUserId!, "buddy_shared_moment");
  await unlockFocusMilestone(database, buddy.ownerUserId!, "buddy_shared_moment");
}

/** Projects stable UI identity and the caller's own client session without changing legacy server references. */
export async function viewerFocusMoment(database: ApplicationDatabase, row: FrogSleepEntityRecord, viewer: string) {
  const ids = [row.payload.session_id, row.payload.buddy_session_id].map(String);
  const sources = await Promise.all(ids.map(id => database.findFrogSleepEntity("focus_session", FROGSLEEP_APP_ID, id)));
  const mine = sources.find(value => value?.ownerUserId === viewer);
  const partner = sources.find(value => value?.ownerUserId && value.ownerUserId !== viewer);
  const bytes = createHash("sha256").update(`${FROGSLEEP_APP_ID}:${row.id}`).digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  const momentId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  if (!mine || !partner) return { ...row.payload, moment_id: momentId };
  const start = Math.max(Date.parse(mine.startsAt ?? ""), Date.parse(partner.startsAt ?? ""));
  const end = Math.min(Date.parse(mine.endsAt ?? ""), Date.parse(partner.endsAt ?? ""));
  return { ...row.payload, moment_id: momentId, server_moment_id: row.id,
    my_session_id: mine.payload.client_session_id ?? mine.id,
    viewer_buddy_session_id: partner.payload.client_session_id ?? partner.id,
    start_time: new Date(start).toISOString(), overlap_minutes: Math.max(0, Math.round((end - start) / 60000)) };
}
