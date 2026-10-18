import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { buildSleepSummaryArtifact, buildSleepRecapArtifact } from "./sleep-buddy-artifacts.ts";

export async function generateSleepMorningArtifacts(database: ApplicationDatabase, session: FrogSleepEntityRecord) {
  const events = await database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID, kind: "sleep_event", sessionId: session.id, limit: 100 });
  const eventTypes = events.map(event => event.status).filter(Boolean) as string[];
  const facts = { participantStates: (session.payload.participantStates as Record<string, unknown> | undefined) ?? {},
    interruptedCount: eventTypes.filter(type => type === "interrupted").length,
    returnedCount: eventTypes.filter(type => type === "returned").length,
    pausedTonight: eventTypes.includes("paused_tonight"),
    completed: eventTypes.includes("morning_completed") || session.status === "completed" };
  for (const userId of [session.ownerUserId, session.partnerUserId].filter(Boolean) as string[]) {
    const partnerUserId = userId === session.ownerUserId ? session.partnerUserId : session.ownerUserId;
    const ownFacts = { ...facts, completed: facts.participantStates[userId] === "morning_completed",
      pausedTonight: facts.participantStates[userId] === "paused_tonight" };
    const summary = buildSleepSummaryArtifact({ session, userId, partnerUserId, ...ownFacts });
    await database.insertFrogSleepEntity(artifactRecord(session, "sleep_summary", userId, partnerUserId, {
      ...commonPayload(session, ownFacts), title: summary.headline,
      participant_state: facts.participantStates[userId] ?? null,
      partner_state: partnerUserId ? facts.participantStates[partnerUserId] ?? null : null, ...summary }));
  }
  const recap = buildSleepRecapArtifact({ requesterUserId: session.ownerUserId!, partnerUserId: session.partnerUserId, ...facts });
  await database.insertFrogSleepEntity(artifactRecord(session, "night_recap", session.ownerUserId, session.partnerUserId, {
    ...commonPayload(session, facts), title: recap.headline, participant_states: facts.participantStates,
    event_types: eventTypes, ...recap }));
}

type SleepFacts = { completed: boolean; interruptedCount: number; returnedCount: number; pausedTonight: boolean };

function commonPayload(session: FrogSleepEntityRecord, facts: SleepFacts) {
  const dateAnchor = String(session.payload.dateAnchor ?? session.payload.date_anchor ?? (session.startsAt ?? session.createdAt).slice(0, 10));
  return { session_id: session.id, relationship_id: session.relationshipId, date_anchor: dateAnchor,
    completed: facts.completed, started_at: session.startsAt, ended_at: session.endsAt,
    interrupted_count: facts.interruptedCount, returned_count: facts.returnedCount,
    paused_tonight: facts.pausedTonight, telemetry_level: "shared_session_events" };
}

function artifactRecord(session: FrogSleepEntityRecord, kind: "sleep_summary" | "night_recap",
  ownerUserId: string | undefined, partnerUserId: string | undefined, payload: Record<string, unknown>): FrogSleepEntityRecord {
  const now = new Date().toISOString();
  return { id: randomId(kind), appId: FROGSLEEP_APP_ID, kind, ownerUserId, partnerUserId,
    relationshipId: session.relationshipId, sessionId: session.id, status: "generated", payload, createdAt: now, updatedAt: now };
}
