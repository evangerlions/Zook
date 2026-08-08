import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { badRequest } from "../../../shared/errors.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import {
  excludedFocusMatchUserIds,
  refreshFocusInviteRelationships,
} from "./focus-buddy-invites.ts";
import {
  buildFocusMatchSearchResult,
  hasMatchingConsent,
} from "./focus-match-ranking.ts";
import {
  otherFocusUserId,
  relationshipsForFocusUser,
} from "./focus-buddy-records.ts";

/// Builds the controlled focus-partner candidate page without changing the public service contract.
export async function searchFocusMatches(
  database: ApplicationDatabase,
  userId: string,
  myProfile: FrogSleepEntityRecord | undefined,
  limit: number,
) {
  if (!myProfile) {
    badRequest("REQ_INVALID_BODY", "Match profile is required before searching.");
  }
  if (!hasMatchingConsent(myProfile)) {
    badRequest("REQ_INVALID_BODY", "Matching consent is required before searching.");
  }
  const relationships = (await refreshFocusInviteRelationships(
    database,
    await relationshipsForFocusUser(database, userId, ["pending", "accepted"]),
  )).filter((item) => item.status === "pending" || item.status === "accepted");
  const pendingOutgoing = relationships.find(
    (item) => item.status === "pending" && item.ownerUserId === userId,
  );
  if (pendingOutgoing) {
    return pendingInviteResult(pendingOutgoing, userId, limit);
  }
  const candidates = await database.listFrogSleepEntities({
    appId: FROGSLEEP_APP_ID,
    kind: "focus_profile",
    status: "active",
    limit: 200,
  });
  const excluded = new Set(relationships.map((item) => otherFocusUserId(item, userId)));
  const feedbackExcluded = await excludedFocusMatchUserIds(
    database,
    userId,
    candidates.map((item) => item.ownerUserId).filter(Boolean) as string[],
  );
  feedbackExcluded.forEach((excludedUserId) => excluded.add(excludedUserId));
  return {
    ...buildFocusMatchSearchResult(myProfile, candidates, excluded, limit),
    pagination: emptyPagination(limit),
  };
}

function pendingInviteResult(
  relationship: FrogSleepEntityRecord,
  userId: string,
  limit: number,
) {
  return {
    candidates: [],
    empty_state: {
      reason: "pending_invites",
      title_key: "buddy_match.empty.pending_invites.title",
      subtitle_key: "buddy_match.empty.pending_invites.subtitle",
      pending_relationship_id: relationship.id,
      pending_user_id: otherFocusUserId(relationship, userId),
    },
    pagination: emptyPagination(limit),
  };
}

function emptyPagination(limit: number) {
  return {
    limit,
    next_cursor: null,
    has_more: false,
  };
}
