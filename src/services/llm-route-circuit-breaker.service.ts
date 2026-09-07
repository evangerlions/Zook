import { createHash, randomUUID } from "node:crypto";

import { KVManager } from "../infrastructure/kv/kv-manager.ts";
import type { LlmRouteCircuitRuntimeStatus } from "../shared/types.ts";
import type { LlmRouteRef } from "./llm-health.service.ts";

const SCOPE = "llm-route-circuit-breaker";
const INDEX_KEY = "route-index";
const FAILURE_WINDOW_MS = 2 * 60 * 1000;
const OPEN_AFTER_FAILURES = 4;
const REQUIRED_DISTINCT_USERS = 2;
const INITIAL_RECOVERY_DELAY_MS = 5 * 60 * 1000;
const RECOVERY_DELAYS_MS = [10, 20, 60, 120].map((minutes) => minutes * 60 * 1000);
const FAILURE_STATE_TTL_SECONDS = 3 * 60;
const LOCK_TTL_SECONDS = 10;
const LOCK_RETRY_COUNT = 50;
const LOCK_RETRY_DELAY_MS = 5;
const PROBE_LEASE_MS = 2 * 60 * 1000;

interface CircuitFailure {
  userHash: string;
  occurredAt: string;
}

interface CircuitState {
  ref: Required<LlmRouteRef>;
  state: "closed" | "confirming" | "open";
  failures: CircuitFailure[];
  confirmationStartedAt?: string;
  confirmationLeaseId?: string;
  confirmationLeaseUntil?: string;
  openedAt?: string;
  blockedUntil?: string;
  nextRecoveryAt?: string;
  recoverySuccessCount: number;
  recoveryFailureCount: number;
  probeLeaseId?: string;
  probeLeaseUntil?: string;
}

export interface LlmRouteCircuitBreakerOptions {
  now?: () => Date;
}

export interface LlmRouteCircuitConfirmation {
  ref: Required<LlmRouteRef>;
  leaseId: string;
}

/**
 * Route-level circuit state is intentionally independent of observability
 * health scores. It only records failed streaming calls before the first
 * effective chunk, and it never retries an end-user request.
 */
export class LlmRouteCircuitBreakerService {
  constructor(
    private readonly kvManager: KVManager,
    private readonly options: LlmRouteCircuitBreakerOptions = {},
  ) {}

  async isOpen(ref: LlmRouteRef, enabled: boolean): Promise<boolean> {
    if (!enabled) return false;
    return (await this.getState(ref))?.state === "open";
  }

  async getRuntimeStatus(
    ref: LlmRouteRef,
    enabled: boolean,
  ): Promise<LlmRouteCircuitRuntimeStatus> {
    if (!enabled) {
      return closedRuntimeStatus(false);
    }
    const state = await this.getState(ref);
    if (!state) return closedRuntimeStatus(true);
    return {
      enabled: true,
      state: state.state,
      failureCount: state.failures.length,
      distinctUserCount: new Set(state.failures.map((failure) => failure.userHash)).size,
      confirmationStartedAt: state.confirmationStartedAt,
      openedAt: state.openedAt,
      blockedUntil: state.blockedUntil,
      nextRecoveryAt: state.nextRecoveryAt,
      recoverySuccessCount: state.recoverySuccessCount,
      recoveryFailureCount: state.recoveryFailureCount,
    };
  }

  async recordFirstEffectiveChunk(
    ref: LlmRouteRef,
    enabled: boolean,
  ): Promise<void> {
    if (!enabled) return;
    await this.withRouteLock(ref, async () => {
      const current = await this.getState(ref);
      if (!current || current.state === "open") return;
      await this.clearRoute(ref);
    });
  }

  async recordPreFirstChunkFailure(
    ref: LlmRouteRef,
    userId: string | undefined,
    enabled: boolean,
  ): Promise<LlmRouteRef | undefined> {
    if (!enabled || !userId?.trim()) return undefined;
    return await this.withRouteLock(ref, async () => {
      const current = await this.getState(ref);
      if (current?.state === "open" || current?.state === "confirming") return undefined;
      const now = this.getNow();
      const failures = (current?.failures ?? [])
        .filter((failure) => now.getTime() - Date.parse(failure.occurredAt) < FAILURE_WINDOW_MS)
        .concat({ userHash: hashUserId(userId), occurredAt: now.toISOString() });
      const distinctUsers = new Set(failures.map((failure) => failure.userHash)).size;
      const shouldOpen = failures.length >= OPEN_AFTER_FAILURES && distinctUsers >= REQUIRED_DISTINCT_USERS;
      const state: CircuitState = shouldOpen
        ? {
            ref: normalizeRef(ref),
            state: "confirming",
            failures,
            confirmationStartedAt: now.toISOString(),
            recoverySuccessCount: 0,
            recoveryFailureCount: 0,
          }
        : {
            ref: normalizeRef(ref),
            state: "closed",
            failures,
            recoverySuccessCount: 0,
            recoveryFailureCount: 0,
      };
      await this.setState(ref, state);
      return shouldOpen ? normalizeRef(ref) : undefined;
    });
  }

  async claimCircuitConfirmation(
    ref: LlmRouteRef,
  ): Promise<LlmRouteCircuitConfirmation | undefined> {
    return await this.withRouteLock(ref, async () => {
      const current = await this.getState(ref);
      const now = this.getNow();
      if (
        !current ||
        current.state !== "confirming" ||
        (current.confirmationLeaseUntil && Date.parse(current.confirmationLeaseUntil) > now.getTime())
      ) return undefined;
      const leaseId = randomUUID();
      await this.setState(current.ref, {
        ...current,
        confirmationLeaseId: leaseId,
        confirmationLeaseUntil: addMilliseconds(now, PROBE_LEASE_MS).toISOString(),
      });
      return { ref: current.ref, leaseId };
    });
  }

  async claimNextCircuitConfirmation(): Promise<LlmRouteCircuitConfirmation | undefined> {
    for (const key of await this.getIndex()) {
      const state = await this.kvManager.getJson<CircuitState>(SCOPE, key);
      if (!state) {
        await this.removeFromIndex(key);
        continue;
      }
      if (state.state !== "confirming") continue;
      const confirmation = await this.claimCircuitConfirmation(state.ref);
      if (confirmation) return confirmation;
    }
    return undefined;
  }

  async completeCircuitConfirmation(
    confirmation: LlmRouteCircuitConfirmation,
    succeeded: boolean,
  ): Promise<"cleared" | "opened" | "skipped"> {
    return (await this.withRouteLock(confirmation.ref, async () => {
      const current = await this.getState(confirmation.ref);
      if (
        !current ||
        current.state !== "confirming" ||
        current.confirmationLeaseId !== confirmation.leaseId
      ) return "skipped" as const;
      if (succeeded) {
        await this.clearRoute(current.ref);
        return "cleared" as const;
      }
      const now = this.getNow();
      await this.setState(current.ref, {
        ...current,
        state: "open",
        confirmationLeaseId: undefined,
        confirmationLeaseUntil: undefined,
        openedAt: now.toISOString(),
        blockedUntil: addMilliseconds(now, INITIAL_RECOVERY_DELAY_MS).toISOString(),
        nextRecoveryAt: addMilliseconds(now, INITIAL_RECOVERY_DELAY_MS).toISOString(),
      });
      return "opened" as const;
    })) ?? "skipped";
  }

  async resetAll(): Promise<void> {
    const keys = await this.getIndex();
    await Promise.all(keys.map((key) => this.kvManager.delete(SCOPE, key)));
    await this.kvManager.delete(SCOPE, INDEX_KEY);
  }

  async resetRoute(ref: LlmRouteRef): Promise<boolean> {
    return (await this.withRouteLock(ref, async () => {
      const current = await this.getState(ref);
      if (!current) return false;
      await this.clearRoute(ref);
      return true;
    })) ?? false;
  }

  async recoverDueRoutes(
    enabled: boolean,
    probe: (ref: Required<LlmRouteRef>) => Promise<boolean>,
  ): Promise<{ attempted: number; restored: number; failed: number }> {
    if (!enabled) {
      await this.resetAll();
      return { attempted: 0, restored: 0, failed: 0 };
    }

    let attempted = 0;
    let restored = 0;
    let failed = 0;
    for (const key of await this.getIndex()) {
      const state = await this.kvManager.getJson<CircuitState>(SCOPE, key);
      if (!state) {
        await this.removeFromIndex(key);
        continue;
      }
      if (state.state !== "open" || !state.nextRecoveryAt || Date.parse(state.nextRecoveryAt) > this.getNow().getTime()) continue;

      const claim = await this.withRouteLock(state.ref, async () => {
        const current = await this.getState(state.ref);
        const now = this.getNow();
        if (!current || current.state !== "open" || !current.nextRecoveryAt || Date.parse(current.nextRecoveryAt) > now.getTime() || (current.probeLeaseUntil && Date.parse(current.probeLeaseUntil) > now.getTime())) {
          return undefined;
        }
        const probeLeaseId = randomUUID();
        await this.setState(current.ref, {
          ...current,
          probeLeaseId,
          probeLeaseUntil: addMilliseconds(now, PROBE_LEASE_MS).toISOString(),
        });
        return { ref: current.ref, probeLeaseId };
      });
      if (!claim) continue;

      // Two immediate smoke checks form one recovery task; neither is a user retry.
      const success = await probe(claim.ref) && await probe(claim.ref);
      const result = await this.withRouteLock(claim.ref, async () => {
        const current = await this.getState(claim.ref);
        if (!current || current.state !== "open" || current.probeLeaseId !== claim.probeLeaseId) return "skipped" as const;
        const now = this.getNow();
        if (success) {
          await this.clearRoute(current.ref);
          return "restored" as const;
        }
        const recoveryFailureCount = current.recoveryFailureCount + 1;
        const delay = RECOVERY_DELAYS_MS[Math.min(recoveryFailureCount - 1, RECOVERY_DELAYS_MS.length - 1)]!;
        await this.setState(current.ref, {
          ...current,
          probeLeaseId: undefined,
          probeLeaseUntil: undefined,
          recoverySuccessCount: 0,
          recoveryFailureCount,
          blockedUntil: addMilliseconds(now, delay).toISOString(),
          nextRecoveryAt: addMilliseconds(now, delay).toISOString(),
        });
        return "failed" as const;
      });
      if (result === "skipped" || result === undefined) continue;
      attempted += 1;
      if (result === "restored") restored += 1;
      if (result === "failed") failed += 1;
    }
    return { attempted, restored, failed };
  }

  private async getState(ref: LlmRouteRef): Promise<CircuitState | undefined> {
    return this.kvManager.getJson<CircuitState>(SCOPE, this.stateKey(ref));
  }

  private async setState(ref: LlmRouteRef, state: CircuitState): Promise<void> {
    const key = this.stateKey(ref);
    // Index first so a worker can always discover a persisted open state.
    await this.addToIndex(key);
    await this.kvManager.setJson(
      SCOPE,
      key,
      state,
      state.state === "closed" ? FAILURE_STATE_TTL_SECONDS : undefined,
    );
  }

  private async clearRoute(ref: LlmRouteRef): Promise<void> {
    const key = this.stateKey(ref);
    await this.kvManager.delete(SCOPE, key);
    await this.removeFromIndex(key);
  }

  private async addToIndex(key: string): Promise<void> {
    const indexed = await this.withIndexLock(async () => {
      const index = await this.getIndex();
      if (!index.includes(key)) {
        await this.kvManager.setJson(SCOPE, INDEX_KEY, [...index, key]);
      }
      return true;
    });
    if (!indexed) throw new Error("LLM route circuit index is temporarily unavailable.");
  }

  private async removeFromIndex(key: string): Promise<void> {
    await this.withIndexLock(async () => {
      const index = await this.getIndex();
      const next = index.filter((item) => item !== key);
      if (next.length) await this.kvManager.setJson(SCOPE, INDEX_KEY, next);
      else await this.kvManager.delete(SCOPE, INDEX_KEY);
    });
  }

  private async getIndex(): Promise<string[]> {
    const value = await this.kvManager.getJson<unknown>(SCOPE, INDEX_KEY);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  }

  private async withRouteLock<T>(ref: LlmRouteRef, task: () => Promise<T>): Promise<T | undefined> {
    return this.withLock(`lock:${this.stateKey(ref)}`, task);
  }

  private async withIndexLock<T>(task: () => Promise<T>): Promise<T | undefined> {
    return this.withLock("index-lock", task);
  }

  private async withLock<T>(key: string, task: () => Promise<T>): Promise<T | undefined> {
    for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt += 1) {
      const acquired = await this.kvManager.setStringIfAbsent(SCOPE, key, randomUUID(), LOCK_TTL_SECONDS);
      if (acquired) {
        try {
          return await task();
        } finally {
          await this.kvManager.delete(SCOPE, key);
        }
      }
      await new Promise<void>((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
    }
    return undefined;
  }

  private stateKey(ref: LlmRouteRef): string {
    return `route:${Buffer.from(JSON.stringify(normalizeRef(ref))).toString("base64url")}`;
  }

  private getNow(): Date {
    return this.options.now?.() ?? new Date();
  }
}

function normalizeRef(ref: LlmRouteRef): Required<LlmRouteRef> {
  return {
    modelKey: ref.modelKey,
    provider: ref.provider,
    providerModel: ref.providerModel,
    operation: ref.operation ?? "chat",
  };
}

function hashUserId(userId: string): string {
  return createHash("sha256").update(userId.trim()).digest("base64url");
}

function addMilliseconds(value: Date, milliseconds: number): Date {
  return new Date(value.getTime() + milliseconds);
}

function closedRuntimeStatus(enabled: boolean): LlmRouteCircuitRuntimeStatus {
  return {
    enabled,
    state: "closed",
    failureCount: 0,
    distinctUserCount: 0,
    recoverySuccessCount: 0,
    recoveryFailureCount: 0,
  };
}
