import type { AiNovelBillingMembershipRecord, AiNovelBillingTransactionRecord } from "../../shared/types/ainovel-billing.ts";

/** Internal entitlement anchor, persisted only through canonical membership writes. */
export function anchorMembershipCredits(
  previous: AiNovelBillingMembershipRecord | undefined,
  next: AiNovelBillingMembershipRecord,
  purchases: Pick<AiNovelBillingTransactionRecord, "purchasedAt" | "originalPurchaseDate" | "expiresAt" | "status" | "source" | "accountDeletedAt">[],
): AiNovelBillingMembershipRecord {
  if (!next.active || next.accountDeletedAt) return { ...next, creditWindowAnchorAt: previous?.creditWindowAnchorAt };
  const observed = Date.parse(next.lastSyncedAt);
  const intervals = purchases.filter(p => p.source === next.source && !p.accountDeletedAt &&
    (p.status === "provider_paid" || p.status === "entitlement_active") && valid(p.purchasedAt) && valid(p.expiresAt))
    .map(p => ({ start: Date.parse(p.purchasedAt!), end: Date.parse(p.expiresAt!) }))
    .filter(p => p.end > p.start && p.start <= observed)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const spells: Array<{ start: number; end: number }> = [];
  for (const interval of intervals) {
    const last = spells.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else spells.push({ ...interval });
  }
  const spell = spells.findLast(p => p.start <= observed && p.end > observed);
  if (!spell) {
    const unchanged = previous?.source === next.source && previous.expiresAt === next.expiresAt;
    const last = spells.at(-1);
    const initialGrace = next.state === "grace_period" && last && next.expiresAt &&
      Date.parse(next.expiresAt) > observed && last.end <= observed;
    if (initialGrace && !previous?.creditWindowAnchorAt) {
      return { ...next, creditWindowAnchorAt: new Date(last.start).toISOString() };
    }
    const grace = previous?.source === next.source && next.state === "grace_period" && previous.creditWindowAnchorAt &&
      previous.expiresAt && next.expiresAt && Date.parse(next.expiresAt) >= Date.parse(previous.expiresAt) &&
      (previous.state === "grace_period" || (last && last.start <= Date.parse(previous.expiresAt) && last.end >= Date.parse(previous.expiresAt)));
    return { ...next, creditWindowAnchorAt: unchanged || grace ? previous?.creditWindowAnchorAt : undefined };
  }
  const previousExpiry = previous?.expiresAt ? Date.parse(previous.expiresAt) : NaN;
  const continuous = previous?.source === next.source && !previous.accountDeletedAt &&
    spell.start <= previousExpiry && spell.end >= previousExpiry;
  const anchor = continuous && previous?.creditWindowAnchorAt ? previous.creditWindowAnchorAt : new Date(spell.start).toISOString();
  return { ...next, creditWindowAnchorAt: anchor };
}

function valid(value: string | null) { return value !== null && Number.isFinite(Date.parse(value)); }
