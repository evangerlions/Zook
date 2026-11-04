import { buildSleepRecapArtifact } from "../sleep-buddy/sleep-buddy-artifacts.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { assertBuddyDataAuthorized } from "./buddy-protected-access.ts";

/** Produces a stable placeholder when a previously generated buddy artifact loses consent. */
export function redactBuddyArtifact(
  artifactType: string,
  reason = "sharing_disabled",
): Record<string, unknown> {
  return {
    artifact_type: artifactType,
    redacted: true,
    unavailable_reason: reason,
  };
}

export function isBuddyAuthorizationDenied(error: unknown): boolean {
  return error instanceof ApplicationError && [403, 404].includes(error.statusCode);
}

/** Loads a sleep artifact only while the viewer still has daily-summary consent. */
export async function latestAuthorizedSleepArtifact(
  database: ApplicationDatabase,
  userId: string,
  relationships: FrogSleepEntityRecord[],
  kind: "sleep_summary" | "night_recap",
): Promise<Record<string, unknown> | null> {
  for (const relationship of relationships) {
    let records = await database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID, kind, relationshipId: relationship.id,
      ownerUserId: userId, limit: 100,
    });
    if (!records.length && kind === "night_recap") records = await database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID, kind, relationshipId: relationship.id, limit: 100 });
    const latest = records.sort((left, right) =>
      String(right.payload.date_anchor ?? right.createdAt).localeCompare(String(left.payload.date_anchor ?? left.createdAt))
      || right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))[0];
    if (!latest) continue;
    try {
      await assertBuddyDataAuthorized(database, userId, relationship.id, "daily_summary");
      return kind === "night_recap" && latest.ownerUserId !== userId ? legacyViewerRecap(latest, userId) : latest.payload;
    } catch (error) {
      if (isBuddyAuthorizationDenied(error)) return redactBuddyArtifact(kind);
      throw error;
    }
  }
  return null;
}

/** Reprojects old single-owner recaps for the second viewer rather than presenting the owner's result as theirs. */
function legacyViewerRecap(row: FrogSleepEntityRecord, viewer: string) {
  const states = row.payload.participant_states;
  if (!states || typeof states !== "object" || !(viewer in states)) return redactBuddyArtifact("night_recap", "legacy_viewer_context_unavailable");
  const recap = buildSleepRecapArtifact({ requesterUserId: viewer,
    partnerUserId: row.ownerUserId === viewer ? row.partnerUserId : row.ownerUserId,
    participantStates: states as Record<string, unknown>, interruptedCount: Number(row.payload.interrupted_count ?? 0),
    returnedCount: Number(row.payload.returned_count ?? 0), pausedTonight: row.payload.paused_tonight === true,
    completed: row.payload.completed === true });
  return { ...row.payload, ...recap };
}
