import type { LLMUsage } from "../../../services/llm-manager-types.ts";
import type { LlmPointPricing } from "../../../shared/types/llm.ts";
import { ApplicationError } from "../../../shared/errors.ts";

export type CreditsTier = "free" | "plus" | "pro";
export type CreditsOutcome = "success" | "failure" | "cancelled";
export interface CreditsMembership { tier: CreditsTier; anchorAt?: string; expiresAt?: string | null; observedAt?: string }
export const CREDIT_MICROS = 1_000_000n;
export const LOCAL_CREDIT_QUOTAS = { free: 20, plus: 1000, pro: 4000 } as const;
const CREDIT_WEEK_MS = 7 * 86400_000;

export interface CreditsAccount {
  tier: CreditsTier;
  periodKey: string;
  refreshAt: string;
  periodicMicros: string;
  giftMicros: string;
  windowAnchorAt?: string;
  membershipAnchorAt?: string;
  spentMicros?: string;
  entitlementObservedAt?: string;
  activeJobId?: string;
  activeJobExpiresAt?: string;
}

/** Server-finalized usage; receipt and debit are persisted in one transaction. */
export interface CreditsReceipt {
  callId: string;
  requestId?: string;
  modelKey: string;
  usage: LLMUsage;
  pricing: LlmPointPricing;
  pointMicros: string;
}

/** Internal server request ledger (legacy table name); not a client workflow. */
export interface CreditsJob {
  id: string;
  status: "active" | CreditsOutcome | "expired";
  expiresAt: string;
  requestId?: string;
  receipts: CreditsReceipt[];
  chargedMicros?: string;
  absorbedMicros?: string;
  grantedMicros?: string;
}

export interface CreditsTransaction {
  account?: CreditsAccount;
  job?: CreditsJob;
}

export interface AiNovelCreditsStore {
  /** Serializes this user's balance/job changes, commits both or neither. */
  transact<T>(userId: string, jobId: string, work: (state: CreditsTransaction) => T): Promise<T>;
}

/** Fixed elapsed-time weeks, independent of tier, calendar, timezone and DST. */
export function creditsPeriod(anchorAt: string, now: Date) {
  const anchor = Date.parse(anchorAt);
  if (!Number.isFinite(anchor) || anchor > now.getTime()) throw new Error("Invalid credit window anchor.");
  const index = Math.floor((now.getTime() - anchor) / CREDIT_WEEK_MS);
  const start = anchor + index * CREDIT_WEEK_MS;
  return { key: new Date(start).toISOString(), refreshAt: new Date(start + CREDIT_WEEK_MS).toISOString() };
}

export function refreshCreditsAccount(account: CreditsAccount | undefined, value: CreditsTier | CreditsMembership, now: Date): CreditsAccount {
  const rawMembership = typeof value === "string" ? { tier: value } : value;
  // Re-evaluate within the account transaction, not only before acquiring its lock.
  const membership = rawMembership.expiresAt && Date.parse(rawMembership.expiresAt) <= now.getTime()
    ? { ...rawMembership, tier: "free" as const } : rawMembership;
  if (membership.observedAt && account?.entitlementObservedAt &&
    Date.parse(membership.observedAt) < Date.parse(account.entitlementObservedAt)) {
    throw new ApplicationError(409, "AINOVEL_CREDITS_ENTITLEMENT_STALE", "Membership changed; retry with the current entitlement.");
  }
  const tier = membership.tier;
  const allowance = BigInt(LOCAL_CREDIT_QUOTAS[tier]) * CREDIT_MICROS;
  const anchorChanged = tier !== "free" && membership.anchorAt !== undefined && account?.membershipAnchorAt !== membership.anchorAt;
  const migratingPaid = account && account.tier !== "free" && !account.windowAnchorAt;
  const newMembership = anchorChanged && !migratingPaid;
  const anchorAt = anchorChanged ? membership.anchorAt! : account?.windowAnchorAt ?? membership.anchorAt ?? now.toISOString();
  const period = creditsPeriod(anchorAt, now);
  const base = { ...account, tier, windowAnchorAt: anchorAt, periodKey: period.key, refreshAt: period.refreshAt,
    entitlementObservedAt: membership.observedAt ?? account?.entitlementObservedAt,
    giftMicros: account?.giftMicros ?? "0",
    membershipAnchorAt: tier === "free" ? account?.membershipAnchorAt : membership.anchorAt ?? account?.membershipAnchorAt };
  if (!account || newMembership || (account.windowAnchorAt && account.periodKey !== period.key)) {
    // Expiry first caps the old allowance even when a weekly boundary was missed.
    const expired = account && account.tier !== "free" && tier === "free";
    const remaining = expired ? min(BigInt(account.periodicMicros), allowance) : allowance;
    return { ...base, periodicMicros: String(remaining), spentMicros: "0" };
  }
  const old = BigInt(account.periodicMicros);
  const previousLimit = BigInt(LOCAL_CREDIT_QUOTAS[account.tier]) * CREDIT_MICROS;
  const inferredSpent = previousLimit - min(old, previousLimit);
  const storedSpent = BigInt(account.spentMicros ?? "0");
  const spent = storedSpent > inferredSpent ? storedSpent : inferredSpent;
  const available = allowance > spent ? allowance - spent : 0n;
  const remaining = allowance > previousLimit ? available : min(old, allowance);
  return { ...base, periodicMicros: String(remaining), spentMicros: String(spent) };
}

function min(a: bigint, b: bigint) { return a < b ? a : b; }
