import type { LlmRouteRef } from "./llm-health.service.ts";

export interface CircuitFailure {
  userHash: string;
  occurredAt: string;
  balanceFailure?: boolean;
}

export interface CircuitState {
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
