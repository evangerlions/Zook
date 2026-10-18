import { badRequest } from "../../../shared/errors.ts";
import { buddyRelationships } from "../buddy-growth/buddy-relationships.ts";
import { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";

export async function relationshipsForFocusUser(
  database: ApplicationDatabase,
  userId: string,
  statuses: string[],
) {
  return (await buddyRelationships(database, userId, "focus"))
    .filter(item => statuses.includes(item.status ?? ""));
}

export function otherFocusUserId(record: FrogSleepEntityRecord, userId: string): string {
  return record.ownerUserId === userId ? (record.partnerUserId as string) : (record.ownerUserId as string);
}

export function focusSessionsOverlap(left: FrogSleepEntityRecord, right: FrogSleepEntityRecord): boolean {
  if (!left.startsAt || !left.endsAt || !right.startsAt || !right.endsAt) {
    return false;
  }
  return new Date(left.startsAt).getTime() < new Date(right.endsAt).getTime() &&
    new Date(right.startsAt).getTime() < new Date(left.endsAt).getTime();
}

export function nextFocusRelationshipStatus(currentStatus: string | undefined, action: string): string {
    if (currentStatus === "revoked") {
      badRequest("REQ_INVALID_BODY", "Revoked focus relationship cannot be changed.");
    }
    if (action === "accept" && currentStatus === "pending") {
      return "accepted";
    }
    if (action === "decline" && currentStatus === "pending") {
      return "declined";
    }
    if (action === "revoke" && (currentStatus === "accepted" || currentStatus === "pending")) {
      return "revoked";
    }
    badRequest("REQ_INVALID_BODY", "Focus relationship action is not valid for the current status.");
  }
