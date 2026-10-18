import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { conflict, forbidden } from "../../../shared/errors.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { buildFocusSessionReport } from "./focus-session-report.ts";
import { buildFocusSessionUpload } from "./focus-session-upload.ts";
import { unlockFocusMilestone } from "./focus-buddy-achievements.ts";

/** Saves account-scoped retries and corrections under the same lock as account deletion. */
export async function storeFocusSession(database: ApplicationDatabase, userId: string, input: Record<string, unknown>) {
  return await database.withAppUserDataTransaction(FROGSLEEP_APP_ID, userId, async () => {
    if ((await database.findAppUser(FROGSLEEP_APP_ID, userId))?.status !== "ACTIVE") {
      forbidden("APP_MEMBER_DELETED", "The app membership is not active.");
    }
    buildFocusSessionUpload(userId, input);
    const candidate = buildFocusSessionReport(userId, input);
    const clientId = candidate.payload.client_session_id;
    if (typeof clientId === "string") {
      const previous = await database.findFrogSleepPersonalRecord("focus_session", userId, clientId);
      if (previous && (input.binding !== undefined || previous.payload._confirmed_import === true)
        && previous.payload._report_fingerprint !== candidate.payload._report_fingerprint) {
        conflict("REQ_INVALID_BODY", "A confirmed imported result cannot be overwritten.");
      }
      if (input.binding !== undefined || previous?.payload._confirmed_import === true) candidate.payload._confirmed_import = true;
    }
    const saved = clientId === undefined
      ? await insertLegacySession(database, candidate)
      : await database.upsertFrogSleepFocusSession(candidate);
    if (saved.inserted) await unlockFocusMilestone(database, userId, "first_session");
    return saved;
  });
}

async function insertLegacySession(database: ApplicationDatabase, record: FrogSleepEntityRecord) {
  await database.insertFrogSleepEntity(record);
  return { record, inserted: true };
}
