import type {
  CreditsAccount,
  CreditsMembership,
  CreditsTier,
  CreditsTransaction,
} from "./ai-novel-credits-model.ts";
import {
  refreshCreditsAccount,
  LOCAL_CREDIT_QUOTAS,
  CREDIT_MICROS,
} from "./ai-novel-credits-model.ts";

import type {
  CreditUsageEvent,
  CreditWindowSnapshot,
} from "../../../shared/types/ai-novel-usage-admin.ts";
export type {
  CreditUsageEvent,
  CreditWindowSnapshot,
} from "../../../shared/types/ai-novel-usage-admin.ts";
export interface CreditReportingWrite {
  at: string;
  previous?: CreditsAccount;
  entitlementExpiresAt?: string;
  event?: CreditUsageEvent;
}

/** Only called inside the existing serialized credit transaction. */
export function synchronizeReportedAccount(
  state: CreditsTransaction,
  membership: CreditsTier | CreditsMembership,
  now: Date,
) {
  state.reporting = {
    at: now.toISOString(),
    previous: state.account ? structuredClone(state.account) : undefined,
  };
  const account = (state.account = refreshCreditsAccount(
    state.account,
    membership,
    now,
  ));
  if (
    typeof membership !== "string" &&
    account.tier !== "free" &&
    membership.expiresAt
  )
    state.reporting.entitlementExpiresAt = membership.expiresAt;
  account.reportingSince ??= now.toISOString();
  return account;
}

export function usageEvent(
  state: CreditsTransaction,
  event: Omit<CreditUsageEvent, "tier" | "periodKey" | "at">,
) {
  if (!state.reporting || !state.account)
    throw new Error("Reporting requires a synchronized account");
  state.reporting.event = {
    ...event,
    at: state.reporting.at,
    tier: state.account.tier,
    periodKey: state.account.periodKey,
  };
}

export function reportedWindow(
  state: CreditsTransaction,
): CreditWindowSnapshot | undefined {
  const account = state.account,
    write = state.reporting;
  if (!account || !write) return undefined;
  const previous = write.previous;
  const limit = BigInt(LOCAL_CREDIT_QUOTAS[account.tier]) * CREDIT_MICROS;
  return {
    start: account.periodKey,
    end: account.refreshAt,
    tier: account.tier,
    limitMicros: String(limit),
    spentMicros: account.spentMicros ?? "0",
    covered:
      Date.parse(account.reportingSince!) <= Date.parse(account.periodKey),
    stable: !(
      previous &&
      previous.tier !== account.tier &&
      (previous.periodKey === account.periodKey || write.at > account.periodKey)
    ),
    ...(write.entitlementExpiresAt
      ? { entitlementExpiresAt: write.entitlementExpiresAt }
      : {}),
    ...(BigInt(account.periodicMicros) === 0n
      ? { firstExhaustAt: write.at }
      : {}),
  };
}

export function invalidatedPreviousWindow(
  state: CreditsTransaction,
): string | undefined {
  const previous = state.reporting?.previous,
    next = state.account;
  if (!previous || !next || previous.periodKey === next.periodKey)
    return undefined;
  const resetAt =
    previous.windowAnchorAt !== next.windowAnchorAt
      ? next.windowAnchorAt
      : next.periodKey;
  return resetAt && resetAt < previous.refreshAt
    ? previous.periodKey
    : undefined;
}
