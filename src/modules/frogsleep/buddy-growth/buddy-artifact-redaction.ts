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
    const records = await database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID, kind, relationshipId: relationship.id,
      ownerUserId: kind === "sleep_summary" ? userId : undefined, limit: 100,
    });
    const latest = records.sort((left, right) =>
      String(right.payload.date_anchor ?? right.createdAt).localeCompare(
        String(left.payload.date_anchor ?? left.createdAt),
      ))[0];
    if (!latest) continue;
    try {
      await assertBuddyDataAuthorized(database, userId, relationship.id, "daily_summary");
      return latest.payload;
    } catch (error) {
      if (isBuddyAuthorizationDenied(error)) return redactBuddyArtifact(kind);
      throw error;
    }
  }
  return null;
}
