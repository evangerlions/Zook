export type BalanceStatus = "ok" | "unconfigured" | "unsupported" | "unauthorized" | "error" | "pending";
export type BalanceScope = "account" | "personal" | "team" | "member" | "key";
export interface BalanceMetric { kind: string; scope: BalanceScope; remaining: number | null; unit: "USD" | "Credits" | "CNY" | "AFP" | "次" | "条" | "%"; unlimited?: boolean; resetAt?: string; }
export interface BalanceSample { status: BalanceStatus; metrics: BalanceMetric[]; detail?: string; }
export interface BalanceSnapshot extends BalanceSample {
  sourceType?: string; loginRevision?: string;
  provider: string; label: string; accountId: string; sharedWith: string[];
  checkedAt?: string; lastSuccessAt?: string; stale: boolean;
  failures: number; safeSamples: number; successfulSamples: number; fingerprint?: string; windowSafeSamples?: Record<string, number>;
}
export interface BalanceRule {
  provider: string;
  accountId: string;
  /** PASSWORDS key name, never a secret value. Required for OpenRouter account credits. */
  managementPasswordKey?: string;
  alerts: boolean;
  warning: number;
  critical: number;
}
export interface BalanceConfig {
  intervalMinutes: number; warningRepeatHours: number; criticalRepeatHours: number;
  failureCount: number; recoverySamples: number; rules: BalanceRule[];
}
export const defaultBalanceConfig = (): BalanceConfig => ({ intervalMinutes: 5, warningRepeatHours: 24,
  criticalRepeatHours: 4, failureCount: 3, recoverySamples: 2, rules: [] });
