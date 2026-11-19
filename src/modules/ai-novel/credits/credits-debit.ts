import type { CreditsTransaction } from "./ai-novel-credits-model.ts";
import { usageEvent, type CreditUsageEvent } from "./credits-reporting.ts";

/** The shared, transaction-scoped debit for model calls and fixed-price tools. */
export function debitCredits(state: CreditsTransaction, total: bigint,
  event: Pick<CreditUsageEvent, "id" | "requestId" | "callId" | "modelKey" | "source">) {
  const { account, job } = state;
  if (!account || !job) throw new Error("Credit debit requires a synchronized account and job.");
  const periodic = BigInt(account.periodicMicros), gifts = BigInt(account.giftMicros);
  const periodicDebit = total < periodic ? total : periodic;
  const rest = total - periodicDebit;
  const giftDebit = rest < gifts ? rest : gifts;
  const charged = periodicDebit + giftDebit;
  account.periodicMicros = String(periodic - periodicDebit);
  account.spentMicros = String(BigInt(account.spentMicros ?? "0") + periodicDebit);
  account.giftMicros = String(gifts - giftDebit);
  job.chargedMicros = String(BigInt(job.chargedMicros ?? "0") + charged);
  job.absorbedMicros = String(BigInt(job.absorbedMicros ?? "0") + total - charged);
  usageEvent(state, { ...event, kind: "debit", periodicMicros: String(periodicDebit),
    giftMicros: String(giftDebit), absorbedMicros: String(total - charged) });
  return { chargedMicros: String(charged), absorbedMicros: String(total - charged) };
}
