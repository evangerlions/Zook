/** Plain admin DTOs: type-only consumers must not pull backend services into the UI. */
type CreditsTier = "free" | "plus" | "pro";
export interface CreditUsageEvent {
  id: string;
  userId?: string;
  at: string;
  kind: "debit" | "denied" | "grant";
  tier: CreditsTier;
  periodKey: string;
  modelKey?: string;
  callId?: string;
  requestId?: string;
  periodicMicros: string;
  giftMicros: string;
  absorbedMicros: string;
}
export interface CreditWindowSnapshot {
  userId?: string;
  start: string;
  end: string;
  tier: CreditsTier;
  limitMicros: string;
  spentMicros: string;
  firstExhaustAt?: string;
  covered: boolean;
  stable: boolean;
  entitlementExpiresAt?: string;
}
interface AccountSnapshot {
  tier: CreditsTier;
  periodicMicros: string;
  giftMicros: string;
  refreshAt: string;
}

export interface UsagePayment {
  userId: string;
  at: string;
  kind: "purchase" | "refund";
  currency: string;
  amountMinor: number;
  sandbox: boolean;
  tier: CreditsTier;
}
export interface UsageSource {
  events: CreditUsageEvent[];
  windows: CreditWindowSnapshot[];
  accounts: { userId: string; account: AccountSnapshot; observedAt: string }[];
  payments: UsagePayment[];
  reportingSince: string | null;
}
export interface UsageFilter {
  from: string;
  to: string;
  asOf: string;
  tier: CreditsTier | "all";
  sandbox: boolean;
  userId?: string;
}
export interface UsageUser {
  userId: string;
  tier: CreditsTier | null;
  chargedPoints: number;
  periodicPoints: number;
  giftPoints: number;
  absorbedPoints: number;
  denied: number;
  balance: {
    periodicPoints: number;
    giftPoints: number;
    observedAt: string;
    refreshAt: string;
  } | null;
  payments: { currency: string; grossMinor: number; refundMinor: number }[];
}
export interface UsageTier {
  tier: CreditsTier;
  limitPoints: number;
  windows: number;
  excludedWindows: number;
  usedPercent: number | null;
  p50: number | null;
  p95: number | null;
  exhausted: number;
  distribution: number[];
  exhaustionDays: number[];
}
export interface UsageReport {
  filter: UsageFilter;
  reportingSince: string | null;
  summary: {
    payingUsers: number;
    activeUsers: number;
    chargedPoints: number;
    giftPoints: number;
    absorbedPoints: number;
    denied: number;
  };
  money: {
    date: string;
    currency: string;
    grossMinor: number;
    refundMinor: number;
  }[];
  daily: {
    date: string;
    periodicPoints: number;
    giftPoints: number;
    absorbedPoints: number;
    denied: number;
  }[];
  tiers: UsageTier[];
  models: { modelKey: string; points: number; calls: number }[];
  users: UsageUser[];
  simulation: {
    tier: CreditsTier;
    limitPoints: number;
    consumption: number[];
  }[];
  detailEvents?: CreditUsageEvent[];
  detailPayments?: UsagePayment[];
}
