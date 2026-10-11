import type {
  CreditWindowSnapshot,
  CreditUsageEvent,
} from "../ai-novel/credits/credits-reporting.ts";
import type { UsageTier } from "../../shared/types/ai-novel-usage-admin.ts";
import {
  LOCAL_CREDIT_QUOTAS,
  type CreditsTier,
} from "../ai-novel/credits/ai-novel-credits-model.ts";

export function points(micros: string): number {
  const value = BigInt(micros);
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Credit report value exceeds safe microcredit range");
  return Number(value) / 1_000_000;
}
export function completeActiveWindows(windows: CreditWindowSnapshot[]) {
  return windows.filter(
    (w) =>
      w.covered &&
      w.stable &&
      BigInt(w.spentMicros) > 0n &&
      (!w.entitlementExpiresAt || w.entitlementExpiresAt >= w.end),
  );
}
function quantile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length
    ? sorted[Math.floor((sorted.length - 1) * fraction)]!
    : null;
}
export function analyzeTier(
  tier: CreditsTier,
  windows: CreditWindowSnapshot[],
): UsageTier {
  const raw = windows.filter((w) => w.tier === tier),
    eligible = completeActiveWindows(raw);
  const spent = eligible.map((w) => points(w.spentMicros)),
    distribution = [0, 0, 0, 0, 0],
    exhaustionDays = [0, 0, 0, 0, 0, 0, 0];
  let exhausted = 0,
    percent = 0;
  for (const w of eligible) {
    const ratio = points(w.spentMicros) / points(w.limitMicros);
    percent += ratio * 100;
    distribution[
      ratio >= 1
        ? 4
        : ratio >= 0.8
          ? 3
          : ratio >= 0.5
            ? 2
            : ratio >= 0.25
              ? 1
              : 0
    ]!++;
    if (w.firstExhaustAt) {
      exhausted++;
      const day = Math.max(
        0,
        Math.min(
          6,
          Math.floor(
            (Date.parse(w.firstExhaustAt) - Date.parse(w.start)) / 86400_000,
          ),
        ),
      );
      exhaustionDays[day]!++;
    }
  }
  return {
    tier,
    limitPoints: LOCAL_CREDIT_QUOTAS[tier],
    windows: eligible.length,
    excludedWindows: raw.length - eligible.length,
    usedPercent: eligible.length ? percent / eligible.length : null,
    p50: quantile(spent, 0.5),
    p95: quantile(spent, 0.95),
    exhausted,
    distribution,
    exhaustionDays,
  };
}

/** Only fully observed windows, observed two-pool consumption, not latent demand. */
export function replayConsumption(
  windows: CreditWindowSnapshot[],
  events: CreditUsageEvent[],
  tier: CreditsTier,
) {
  const eligible = completeActiveWindows(
    windows.filter((w) => w.tier === tier),
  );
  const gifts = new Map<string, bigint>();
  for (const e of events)
    if (e.kind === "debit") {
      const key = JSON.stringify([e.userId, e.periodKey]);
      gifts.set(key, (gifts.get(key) ?? 0n) + BigInt(e.giftMicros));
    }
  return eligible.map((w) =>
    points(
      String(
        BigInt(w.spentMicros) +
          (gifts.get(JSON.stringify([w.userId, w.start])) ?? 0n),
      ),
    ),
  );
}
