import type { AiNovelBillingMembershipInfo, AiNovelBillingMembershipRecord, AiNovelBillingSource } from "../../shared/types.ts";
import type { NormalizedRevenueCatSnapshot } from "./ainovel-revenuecat-normalizer.ts";

export function billingChannelsConflict(current: string | null | undefined, target: string | null | undefined): boolean {
  return !!current && !!target && current !== target;
}

export function activeBillingMembership(membership: Pick<AiNovelBillingMembershipInfo, "active" | "expiresAt"> | undefined, now: Date): boolean {
  return !!membership?.active && (!membership.expiresAt || Date.parse(membership.expiresAt) > now.getTime());
}

/** Keep the established channel while valid; financial evidence is saved separately. */
export function selectStoreMembership(snapshot: NormalizedRevenueCatSnapshot,
  current: AiNovelBillingMembershipRecord | undefined, now: Date, transferredAway = false): AiNovelBillingMembershipRecord {
  const candidates = snapshot.activeMemberships ?? (snapshot.membership.active ? [snapshot.membership] : []);
  if (current && activeBillingMembership(current, now)) {
    const sameChannel = candidates.find(candidate => candidate.source === current.source);
    if (sameChannel) return { ...snapshot.membership, ...sameChannel };
    // A complete verified snapshot can revoke access before its cached expiry.
    // Missing evidence is not revocation; cancelled renewal with access stays protected.
    const originalRevoked = current.source !== "alipay" && (transferredAway || snapshot.observedMemberships?.some(
      observed => observed.source === current.source && !observed.active));
    if (originalRevoked) return snapshot.membership;
    return current;
  }
  if (current?.source === "alipay" && !snapshot.membership.active) return current;
  return snapshot.membership;
}

export function storeSnapshotConflicts(snapshot: NormalizedRevenueCatSnapshot, membership: AiNovelBillingMembershipInfo): boolean {
  const candidates = snapshot.activeMemberships ?? (snapshot.membership.active ? [snapshot.membership] : []);
  const sources = new Set<AiNovelBillingSource | null>(candidates.map(candidate => candidate.source));
  return sources.size > 1 || (membership.active && candidates.some(candidate => billingChannelsConflict(membership.source, candidate.source)));
}
