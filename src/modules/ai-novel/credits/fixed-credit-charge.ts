import { ApplicationError } from "../../../shared/errors.ts";
import type { AiNovelCreditsStore, CreditsMembership, CreditsTier } from "./ai-novel-credits-model.ts";
import { synchronizeReportedAccount, usageEvent } from "./credits-reporting.ts";
import { debitCredits } from "./credits-debit.ts";

export interface FixedCreditCharge {
  id: string;
  source: "web_search";
  inputHash: string;
  pointMicros: string;
}
export type FixedChargeResult = "allowed" | "charged" | "replayed" | "quota_insufficient";

/** Uses the same account lock, pools, ledger and environment as model charging. */
export class FixedCreditCharges {
  constructor(private readonly store: AiNovelCreditsStore,
    private readonly membership: (userId: string) => Promise<CreditsTier | CreditsMembership>,
    private readonly now: () => Date) {}

  apply(userId: string, requestId: string, charge: FixedCreditCharge, settle: true, signal?: AbortSignal): Promise<Exclude<FixedChargeResult, "allowed">>;
  apply(userId: string, requestId: string, charge: FixedCreditCharge, settle: false, signal?: AbortSignal): Promise<Exclude<FixedChargeResult, "charged">>;
  async apply(userId: string, requestId: string, charge: FixedCreditCharge, settle: boolean, signal?: AbortSignal): Promise<FixedChargeResult> {
    if (!/^[a-f0-9]{64}$/.test(charge.id) || !/^[a-f0-9]{64}$/.test(charge.inputHash)
      || !/^[1-9]\d*$/.test(charge.pointMicros)) throw new Error("Invalid fixed credit charge.");
    signal?.throwIfAborted();
    const membership = await this.membership(userId);
    const jobId = `tool:${charge.source}:${charge.id}`;
    return this.store.transact(userId, jobId, state => {
      signal?.throwIfAborted();
      if (state.job) {
        const previous = state.job.fixedCharge;
        if (state.job.status !== "success" || previous?.source !== charge.source || previous.inputHash !== charge.inputHash)
          throw new ApplicationError(409, "AINOVEL_CREDITS_JOB_CONFLICT", "Search call ID was reused with different input.");
        return "replayed";
      }
      const account = synchronizeReportedAccount(state, membership, this.now());
      if (BigInt(account.periodicMicros) + BigInt(account.giftMicros) < BigInt(charge.pointMicros)) {
        usageEvent(state, { id: `denied:${requestId}`, kind: "denied", requestId, source: charge.source,
          periodicMicros: "0", giftMicros: "0", absorbedMicros: "0" });
        return "quota_insufficient";
      }
      if (!settle) return "allowed";
      state.job = { id: jobId, status: "success", expiresAt: this.now().toISOString(), receipts: [], fixedCharge: { ...charge } };
      debitCredits(state, BigInt(charge.pointMicros), { id: `debit:${jobId}`, requestId, callId: charge.id, source: charge.source });
      return "charged";
    });
  }
}
