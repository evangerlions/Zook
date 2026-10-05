import type { LLMUsage } from "../../../services/llm-manager-types.ts";
import type { LlmPointPricing } from "../../../shared/types/llm.ts";

export type CreditsTier = "free" | "plus" | "pro";
export type CreditsOutcome = "success" | "failure" | "cancelled";
export const CREDIT_MICROS = 1_000_000n;
export const LOCAL_CREDIT_QUOTAS = { free: 20, plus: 1000, pro: 4000 } as const;

export interface CreditsAccount {
  tier: CreditsTier;
  periodKey: string;
  refreshAt: string;
  periodicMicros: string;
  giftMicros: string;
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

export function creditsPeriod(tier: CreditsTier, now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let end: Date;
  if (tier === "free") {
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    end = new Date(start.getTime() + 7 * 86400_000);
  } else {
    start.setUTCDate(1);
    end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  }
  return { key: `${tier}:${start.toISOString()}`, refreshAt: end.toISOString() };
}

export function refreshCreditsAccount(account: CreditsAccount | undefined, tier: CreditsTier, now: Date): CreditsAccount {
  const period = creditsPeriod(tier, now);
  const allowance = BigInt(LOCAL_CREDIT_QUOTAS[tier]) * CREDIT_MICROS;
  if (!account) return { tier, periodKey: period.key, refreshAt: period.refreshAt, periodicMicros: String(allowance), giftMicros: "0" };
  if (account.tier === tier && account.periodKey === period.key) return account;
  const old = BigInt(account.periodicMicros);
  // Downgrades/expiry never replenish. Upgrade grants only the allowance difference.
  const downgrade = LOCAL_CREDIT_QUOTAS[tier] < LOCAL_CREDIT_QUOTAS[account.tier];
  const samePeriod = tier !== "free" && account.tier !== "free" && account.periodKey.split(":").slice(1).join(":") === period.key.split(":").slice(1).join(":");
  const upgraded = old + allowance - BigInt(LOCAL_CREDIT_QUOTAS[account.tier]) * CREDIT_MICROS;
  const remaining = downgrade ? (old < allowance ? old : allowance) : samePeriod ? upgraded : allowance;
  return { ...account, tier, periodKey: period.key, refreshAt: period.refreshAt, periodicMicros: String(remaining) };
}
