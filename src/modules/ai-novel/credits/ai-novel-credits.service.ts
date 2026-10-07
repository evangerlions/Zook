import { ApplicationError } from "../../../shared/errors.ts";
import type { StructuredLogger } from "../../../infrastructure/logging/pino-logger.module.ts";
import { pointMicrosToPoints } from "../../../services/llm-point-pricing.ts";
import {
  CREDIT_MICROS, LOCAL_CREDIT_QUOTAS, refreshCreditsAccount,
  type AiNovelCreditsStore, type CreditsOutcome, type CreditsReceipt, type CreditsTier, type CreditsMembership,
} from "./ai-novel-credits-model.ts";

const JOB_LEASE_MS = 30 * 60_000;
const MAX_RECEIPTS = 1024;

export class AiNovelCreditsService {
  constructor(
    private readonly store: AiNovelCreditsStore,
    private readonly membership: (userId: string) => Promise<CreditsTier | CreditsMembership>,
    private readonly logger?: StructuredLogger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async balance(userId: string) {
    const raw = await this.balanceMicros(userId);
    return {
      tier: raw.tier, periodicPoints: pointMicrosToPoints(raw.periodicMicros)!,
      periodicLimit: LOCAL_CREDIT_QUOTAS[raw.tier], giftPoints: pointMicrosToPoints(raw.giftMicros)!,
      remainingPoints: pointMicrosToPoints(raw.remainingMicros)!, refreshAt: raw.refreshAt,
    };
  }

  async balanceMicros(userId: string) {
    const membership = await this.membership(userId);
    return this.store.transact(userId, "", (state) => {
      const previous = state.account;
      const account = state.account = refreshCreditsAccount(state.account, membership, this.now());
      if (previous?.periodKey !== account.periodKey || previous?.tier !== account.tier) {
        this.logger?.info("AINovel credits window synchronized", { userId, tier: account.tier,
          anchorAt: account.windowAnchorAt, refreshAt: account.refreshAt, previousTier: previous?.tier });
      }
      return {
        tier: account.tier, periodicMicros: account.periodicMicros,
        periodicLimitMicros: String(BigInt(LOCAL_CREDIT_QUOTAS[account.tier]) * CREDIT_MICROS),
        giftMicros: account.giftMicros,
        remainingMicros: String(BigInt(account.periodicMicros) + BigInt(account.giftMicros)),
        refreshAt: account.refreshAt,
      };
    });
  }

  async begin(userId: string, jobId: string, requestId: string): Promise<"allowed" | "quota_insufficient"> {
    requireId(jobId); requireId(requestId);
    if (jobId.startsWith("gift:")) throw conflict("Reserved job ID namespace.");
    const membership = await this.membership(userId);
    return this.store.transact(userId, jobId, (state) => {
      const now = this.now();
      const account = state.account = refreshCreditsAccount(state.account, membership, now);
      if (account.activeJobExpiresAt && Date.parse(account.activeJobExpiresAt) <= now.getTime()) {
        delete account.activeJobId;
        delete account.activeJobExpiresAt;
      }
      if (state.job && state.job.status !== "active") throw conflict("Job has already finished.");
      if (account.activeJobId && account.activeJobId !== jobId) throw conflict("Another AI job is active.");
      if (state.job?.requestId) throw conflict("Another request in this job is active.");
      if (BigInt(account.periodicMicros) + BigInt(account.giftMicros) <= 0n) {
        this.logger?.info("AINovel credits admission denied", { userId, jobId, requestId, reason: "quota_insufficient" });
        return "quota_insufficient";
      }
      account.activeJobId = jobId;
      state.job ??= { id: jobId, status: "active", expiresAt: new Date(now.getTime() + JOB_LEASE_MS).toISOString(), receipts: [] };
      if (Date.parse(state.job.expiresAt) <= now.getTime()) throw conflict("Request lease expired; use a new server request.");
      state.job.requestId = requestId;
      state.job.expiresAt = new Date(now.getTime() + JOB_LEASE_MS).toISOString();
      account.activeJobExpiresAt = state.job.expiresAt;
      this.logger?.info("AINovel credits request admitted", { userId, jobId, requestId });
      return "allowed";
    });
  }

  /** Successful provider callback: atomically persist receipt and debit now. */
  async record(userId: string, jobId: string, requestId: string, receipt: CreditsReceipt): Promise<void> {
    validateReceipt(receipt);
    const membership = await this.membership(userId);
    await this.store.transact(userId, jobId, (state) => {
      const job = state.job;
      if (job?.receipts.some((item) => item.callId === receipt.callId)) return;
      if (!job || job.status !== "active" || job.requestId !== requestId) throw conflict("No matching active request.");
      if (state.account?.activeJobId !== jobId) throw conflict("AI request no longer owns account admission.");
      if (Date.parse(job.expiresAt) <= this.now().getTime()) throw conflict("AI job lease expired.");
      if (job.receipts.length >= MAX_RECEIPTS) throw conflict("AI job attempt limit exceeded.");
      const account = state.account = refreshCreditsAccount(state.account, membership, this.now());
      const total = BigInt(receipt.pointMicros);
      const periodic = BigInt(account.periodicMicros), gifts = BigInt(account.giftMicros);
      const periodicDebit = total < periodic ? total : periodic;
      const rest = total - periodicDebit;
      const giftDebit = rest < gifts ? rest : gifts;
      const charged = periodicDebit + giftDebit;
      account.periodicMicros = String(periodic - periodicDebit);
      account.spentMicros = String(BigInt(account.spentMicros ?? "0") + periodicDebit);
      account.giftMicros = String(gifts - giftDebit);
      job.receipts.push({ ...structuredClone(receipt), requestId });
      job.chargedMicros = String(BigInt(job.chargedMicros ?? "0") + charged);
      job.absorbedMicros = String(BigInt(job.absorbedMicros ?? "0") + total - charged);
      this.logger?.info("AINovel credits call settled", {
        userId, requestId, callId: receipt.callId, modelKey: receipt.modelKey,
        chargedMicros: String(charged), absorbedMicros: String(total - charged),
      });
    });
  }

  async releaseRequest(userId: string, jobId: string, requestId: string): Promise<void> {
    await this.closeRequest(userId, jobId, requestId, "success");
  }

  async renewRequest(userId: string, jobId: string, requestId: string): Promise<void> {
    await this.store.transact(userId, jobId, (state) => {
      const job = state.job;
      if (!job || job.status !== "active" || job.requestId !== requestId || state.account?.activeJobId !== jobId) {
        throw conflict("Cannot renew an unowned AI request.");
      }
      const now = this.now();
      if (Date.parse(job.expiresAt) <= now.getTime()) throw conflict("Cannot renew an expired AI request.");
      job.expiresAt = new Date(now.getTime() + JOB_LEASE_MS).toISOString();
      state.account.activeJobExpiresAt = job.expiresAt;
    });
  }

  /** Release server request ownership. Already successful calls are never refunded. */
  async closeRequest(userId: string, jobId: string, requestId: string, outcome: CreditsOutcome): Promise<void> {
    await this.store.transact(userId, jobId, (state) => {
      const job = state.job;
      if (!job || job.status !== "active" || job.requestId !== requestId) return;
      delete job.requestId;
      job.status = outcome;
      job.chargedMicros ??= "0";
      job.absorbedMicros ??= "0";
      if (state.account?.activeJobId === jobId) {
        delete state.account.activeJobId;
        delete state.account.activeJobExpiresAt;
      }
      this.logger?.info("AINovel credits request closed", { userId, jobId, requestId, outcome, chargedMicros: job.chargedMicros });
    });
  }

  /** Internal/admin-only grant. Deterministic event ID provides retry safety. */
  async grant(userId: string, eventId: string, points: number): Promise<void> {
    requireId(eventId);
    if (!Number.isSafeInteger(points) || points <= 0) throw new ApplicationError(400, "AINOVEL_CREDITS_GRANT_INVALID", "Gift points must be a positive safe integer.");
    const membership = await this.membership(userId);
    await this.store.transact(userId, `gift:${eventId}`, (state) => {
      const amount = String(BigInt(points) * CREDIT_MICROS);
      if (state.job) {
        if (state.job.grantedMicros !== amount) throw conflict("Gift event ID was reused with a different amount.");
        return;
      }
      const account = state.account = refreshCreditsAccount(state.account, membership, this.now());
      const nextGift = BigInt(account.giftMicros) + BigInt(points) * CREDIT_MICROS;
      // Reserve room for the largest periodic allowance, including future upgrades.
      if (nextGift + BigInt(LOCAL_CREDIT_QUOTAS.pro) * CREDIT_MICROS > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new ApplicationError(400, "AINOVEL_CREDITS_GRANT_INVALID", "Gift would exceed the safe microcredit balance limit.");
      }
      account.giftMicros = String(nextGift);
      state.job = { id: `gift:${eventId}`, status: "success", expiresAt: this.now().toISOString(), receipts: [], chargedMicros: "0", absorbedMicros: "0", grantedMicros: amount };
      this.logger?.info("AINovel gift credits granted", { userId, eventId, points });
    });
  }
}

function requireId(value: string) {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(value)) throw new ApplicationError(400, "AINOVEL_CREDITS_ID_INVALID", "Credit job/request ID is invalid.");
}
function conflict(message: string) { return new ApplicationError(409, "AINOVEL_CREDITS_JOB_CONFLICT", message); }
function validateReceipt(receipt: CreditsReceipt) {
  requireId(receipt.callId);
  if (!/^\d+$/.test(receipt.pointMicros)) throw new ApplicationError(502, "AINOVEL_CREDITS_USAGE_INVALID", "Missing or invalid server-priced usage.");
}
