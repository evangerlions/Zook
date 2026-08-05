import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { forbidden } from "../../../shared/errors.ts";
import type { BuddySharingCategory } from "./buddy-growth-contract.ts";
import { BuddyConsentService } from "./buddy-consent.service.ts";
import { relationshipsForFocusUser } from "../focus-buddy/focus-buddy-records.ts";

/** Coordinates category authorization for existing buddy domain services. */
export async function assertBuddyDataAuthorized(
  database: ApplicationDatabase,
  userId: string,
  relationshipId: string,
  category: BuddySharingCategory,
): Promise<void> {
  await new BuddyConsentService(database).assertAuthorized(userId, relationshipId, category);
}

/** Returns accepted focus relationships that may expose interaction context to the viewer. */
export async function authorizedFocusMessageRelationshipIds(
  database: ApplicationDatabase,
  userId: string,
  buddyUserId?: string,
): Promise<Set<string>> {
  const candidates = await relationshipsForFocusUser(database, userId, ["accepted"]);
  const relationships = buddyUserId
    ? candidates.filter((item) => [item.ownerUserId, item.partnerUserId].includes(buddyUserId))
    : candidates;
  if (buddyUserId && relationships.length === 0) {
    forbidden("AUTH_APP_SCOPE_MISMATCH", "Accepted focus buddy relationship is required.");
  }
  for (const relationship of relationships) {
    await assertBuddyDataAuthorized(database, userId, relationship.id, "shared_activity");
  }
  return new Set(relationships.map((relationship) => relationship.id));
}
