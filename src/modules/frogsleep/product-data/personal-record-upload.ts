import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { badRequest, conflict, forbidden } from "../../../shared/errors.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { parseIsoTimestamp } from "../frogsleep-validation.ts";

export function validatePersonalRecordOwner(input: Record<string, unknown>, userId: string): void {
  for (const owner of [input.owner_user_id, input.ownerUserId, input.user_id, input.userId]) {
    if (owner !== undefined && owner !== userId)
      forbidden("AUTH_APP_SCOPE_MISMATCH", "The upload owner must match the authenticated account.");
  }
  if (input.binding === undefined) return;
  const binding = input.binding as Record<string, unknown>;
  if (!binding || typeof binding !== "object" || Array.isArray(binding))
    badRequest("REQ_INVALID_BODY", "binding must be an object.");
  if (binding.owner_user_id !== userId)
    forbidden("AUTH_APP_SCOPE_MISMATCH", "The binding job belongs to another account.");
  if (typeof binding.job_id !== "string" || !binding.job_id.trim())
    badRequest("REQ_INVALID_BODY", "binding.job_id is required.");
  parseIsoTimestamp(binding.confirmed_at, "binding.confirmed_at");
}

export function personalRecordId(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== "string" || !input.trim() || input.trim().length > 256)
    badRequest("REQ_INVALID_BODY", "The client record ID must contain 1 to 256 characters.");
  return input.trim();
}

export async function insertPersonalRecord(database: ApplicationDatabase, record: FrogSleepEntityRecord,
  clientId: string | undefined): Promise<{ record: FrogSleepEntityRecord; created: boolean }> {
  return await database.withAppUserDataTransaction(FROGSLEEP_APP_ID, record.ownerUserId!, async () => {
    const membership = await database.findAppUser(FROGSLEEP_APP_ID, record.ownerUserId!);
    if (membership?.status !== "ACTIVE") forbidden("APP_MEMBER_DELETED", "The app membership is not active.");
    if (clientId) {
      const existing = await database.findFrogSleepPersonalRecord(record.kind, record.ownerUserId!, clientId);
      if (existing) {
        if (!isDeepStrictEqual(comparable(existing), comparable(record)))
          conflict("REQ_INVALID_BODY", "This record ID already contains a different terminal result.");
        return { record: existing, created: false };
      }
      record.id = `${record.kind}_${createHash("sha256")
        .update(JSON.stringify([record.appId, record.ownerUserId, clientId])).digest("hex")}`;
    }
    await database.insertFrogSleepEntity(record);
    return { record, created: true };
  });
}

function comparable(record: FrogSleepEntityRecord): unknown {
  return JSON.parse(JSON.stringify({ status: record.status, startsAt: record.startsAt,
    endsAt: record.endsAt, occurredAt: record.occurredAt, payload: record.payload }));
}
