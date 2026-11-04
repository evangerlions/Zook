import { ApplicationError } from "../shared/errors.ts";

/** Classify only structured, provider-specific credit errors, never message text. */
export function isLlmBalanceFailure(provider: string, error: unknown): boolean {
  if (!(error instanceof ApplicationError)) return false;
  if (!error.details || typeof error.details !== "object") return false;
  const details = error.details as Record<string, unknown>;
  if (details.provider && details.provider !== provider) return false;
  if (provider === "bai") return details.errorCode === "insufficient_user_quota";
  // Explicit credits source only. Request-budget and unknown reasons stay generic.
  return provider === "openrouter" && details.limitSource === "openrouter_credits"
    && details.creditReason === undefined
    && (details.statusCode === 402 || details.errorCode === 402 || details.errorCode === "402");
}
