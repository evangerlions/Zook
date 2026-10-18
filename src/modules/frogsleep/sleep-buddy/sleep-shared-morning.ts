import { createHash } from "node:crypto";
import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { buildSleepRecapArtifact, buildSleepSummaryArtifact } from "./sleep-buddy-artifacts.ts";

/** Maintains one viewer-specific morning summary and recap per shared session under lifecycle locks. */
export async function generateSharedMorningArtifacts(database: ApplicationDatabase, session: FrogSleepEntityRecord) {
  const users = [session.ownerUserId, session.partnerUserId].filter(Boolean) as string[];
  const events = await database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID, kind: "sleep_event", sessionId: session.id, limit: 500 });
  const states = (session.payload.participantStates as Record<string, unknown> | undefined) ?? {};
  const eventTypes = events.map(event => event.status).filter(Boolean) as string[];
  const common = { participantStates: states,
    interruptedCount: eventTypes.filter(value => value === "interrupted").length,
    returnedCount: eventTypes.filter(value => value === "returned").length,
    pausedTonight: eventTypes.includes("paused_tonight"),
    completed: eventTypes.includes("morning_completed") };
  for (const viewer of users) {
    const partner = users.find(value => value !== viewer);
    const summary = buildSleepSummaryArtifact({ session, userId: viewer, partnerUserId: partner, ...common });
    await saveArtifact(database, session, viewer, partner, "sleep_summary", { ...basePayload(session),
      owner_user_id: viewer, participant_state: states[viewer] ?? null, partner_state: partner ? states[partner] ?? null : null,
      completed: states[viewer] === "morning_completed", interrupted_count: common.interruptedCount,
      returned_count: common.returnedCount, ...summary });
    const recap = buildSleepRecapArtifact({ requesterUserId: viewer, partnerUserId: partner, ...common });
    await saveArtifact(database, session, viewer, partner, "night_recap", { ...basePayload(session),
      owner_user_id: viewer, participant_states: states, event_types: eventTypes,
      completed: users.every(user => states[user] === "morning_completed"), interrupted_count: common.interruptedCount,
      returned_count: common.returnedCount, paused_tonight: common.pausedTonight, ...recap });
  }
}

function basePayload(session: FrogSleepEntityRecord) {
  return { session_id: session.id, relationship_id: session.relationshipId,
    date_anchor: session.payload.dateAnchor ?? session.payload.date_anchor ?? session.startsAt?.slice(0, 10),
    started_at: session.startsAt, ended_at: session.endsAt, telemetry_level: "shared_session_events" };
}

async function saveArtifact(database: ApplicationDatabase, session: FrogSleepEntityRecord, viewer: string,
  partner: string | undefined, kind: "sleep_summary" | "night_recap", payload: Record<string, unknown>) {
  const previous = (await database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID, kind, sessionId: session.id, ownerUserId: viewer, limit: 100 }))[0];
  if (previous) {
    await database.updateFrogSleepEntity(kind, FROGSLEEP_APP_ID, previous.id,
      { payload: { ...payload, title: payload.headline }, updatedAt: new Date().toISOString() });
    return;
  }
  const timestamp = new Date().toISOString();
  const hash = createHash("sha256").update(JSON.stringify([FROGSLEEP_APP_ID, session.id, viewer, kind])).digest("hex");
  await database.insertFrogSleepEntity({ id: `${kind}_${hash}`, appId: FROGSLEEP_APP_ID, kind,
    ownerUserId: viewer, partnerUserId: partner, relationshipId: session.relationshipId, sessionId: session.id,
    status: "generated", payload: { ...payload, title: payload.headline }, createdAt: timestamp, updatedAt: timestamp });
}
