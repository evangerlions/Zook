import type { FrogSleepEntityRecord } from "../../../shared/types.ts";

const MATCH_PROFILE_STALE_MS = 30 * 24 * 60 * 60 * 1000;

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

export function buildFocusMatchProfilePayload(displayName: string, input: Record<string, unknown>) {
  return {
    display_name: displayName,
    study_types: Array.isArray(input.study_types) ? input.study_types : input.studyTypes,
    scene_tags: Array.isArray(input.scene_tags) ? input.scene_tags : input.sceneTags,
    active_period: input.active_period ?? input.activePeriod,
    strictness: input.strictness ?? "balanced",
    gender_identity: input.gender_identity ?? input.genderIdentity,
    gender_preference: input.gender_preference ?? input.genderPreference ?? "no_preference",
    bio: input.bio,
    matching_consent: input.matching_consent === true || input.matchingConsent === true,
  };
}

export function hasMatchingConsent(profile: FrogSleepEntityRecord): boolean {
  return profile.payload.matching_consent === true || profile.payload.matchingConsent === true;
}

export function buildFocusMatchSearchResult(
  myProfile: FrogSleepEntityRecord,
  candidates: FrogSleepEntityRecord[],
  excludedUserIds: Set<string>,
  limit: number,
) {
  const pool = candidates
    .filter((item) => item.ownerUserId !== myProfile.ownerUserId)
    .filter((item) => item.ownerUserId ? !excludedUserIds.has(item.ownerUserId) : false);
  const consented = pool.filter(hasMatchingConsent);
  const recent = consented.filter(isRecentMatchProfile);
  const compatible = recent.filter((item) => isGenderCompatible(myProfile, item));
  const ranked = compatible
    .map((item) => toMatchCandidate(myProfile, item))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
  return {
    candidates: ranked,
    empty_state: ranked.length === 0 ? matchEmptyState(pool, consented, recent) : null,
  };
}

function isRecentMatchProfile(profile: FrogSleepEntityRecord): boolean {
  const updatedAt = new Date(profile.updatedAt).getTime();
  return Number.isFinite(updatedAt) && Date.now() - updatedAt <= MATCH_PROFILE_STALE_MS;
}

function isGenderCompatible(myProfile: FrogSleepEntityRecord, candidate: FrogSleepEntityRecord): boolean {
  return preferenceAccepts(
    myProfile.payload.gender_preference,
    myProfile.payload.gender_identity,
    candidate.payload.gender_identity,
  ) &&
    preferenceAccepts(
      candidate.payload.gender_preference,
      candidate.payload.gender_identity,
      myProfile.payload.gender_identity,
    );
}

function preferenceAccepts(preference: unknown, ownerIdentity: unknown, targetIdentity: unknown): boolean {
  switch (preference) {
    case "same_gender":
      return ownerIdentity !== undefined && ownerIdentity === targetIdentity && ownerIdentity !== "prefer_not_to_say";
    case "women_only":
      return targetIdentity === "woman";
    case "men_only":
      return targetIdentity === "man";
    default:
      return true;
  }
}

function toMatchCandidate(myProfile: FrogSleepEntityRecord, candidate: FrogSleepEntityRecord) {
  const myTags = new Set(stringArray(myProfile.payload.scene_tags));
  const myStudyTypes = new Set(stringArray(myProfile.payload.study_types));
  const candidateTags = stringArray(candidate.payload.scene_tags);
  const candidateStudyTypes = stringArray(candidate.payload.study_types);
  const matchedScenes = candidateTags.filter((tag) => myTags.has(tag));
  const matchedStudyTypes = candidateStudyTypes.filter((type) => myStudyTypes.has(type));
  const explanation: string[] = [];
  let score = 0;

  if (matchedScenes.length > 0) {
    explanation.push("scene_tags");
    score += Math.round((matchedScenes.length / Math.max(candidateTags.length, 1)) * 60);
  }
  if (matchedStudyTypes.length > 0) {
    explanation.push("study_types");
    score += Math.round((matchedStudyTypes.length / Math.max(candidateStudyTypes.length, 1)) * 15);
  }
  if (candidate.payload.active_period === myProfile.payload.active_period) {
    explanation.push("active_period");
    score += 20;
  }
  if (hasExplicitGenderPreference(myProfile) || hasExplicitGenderPreference(candidate)) {
    explanation.push("gender_preference");
    score += 5;
  }

  const profile = toProfilePayload(candidate);
  return {
    user_id: candidate.ownerUserId,
    score: Math.min(score, 100),
    matched_scenes: matchedScenes,
    matched_study_types: matchedStudyTypes,
    explanation,
    last_active_label: "recently",
    ...profile,
    profile,
  };
}

function hasExplicitGenderPreference(profile: FrogSleepEntityRecord): boolean {
  const preference = profile.payload.gender_preference;
  return typeof preference === "string" && preference !== "no_preference";
}

function toProfilePayload(profile: FrogSleepEntityRecord) {
  return {
    id: profile.id,
    profile_id: profile.id,
    user_id: profile.ownerUserId,
    status: profile.status,
    is_active: profile.status === "active",
    created_at: profile.createdAt,
    updated_at: profile.updatedAt,
    ...profile.payload,
  };
}

function matchEmptyState(
  pool: FrogSleepEntityRecord[],
  consented: FrogSleepEntityRecord[],
  recent: FrogSleepEntityRecord[],
) {
  const reason = emptyStateReason(pool, consented, recent);
  return {
    reason,
    title_key: `buddy_match.empty.${reason}.title`,
    subtitle_key: `buddy_match.empty.${reason}.subtitle`,
  };
}

function emptyStateReason(
  pool: FrogSleepEntityRecord[],
  consented: FrogSleepEntityRecord[],
  recent: FrogSleepEntityRecord[],
) {
  if (pool.length === 0) {
    return "no_candidates";
  }
  if (consented.length === 0) {
    return "no_compatible_candidates";
  }
  if (recent.length === 0) {
    return "no_recent_candidates";
  }
  return "no_compatible_candidates";
}
