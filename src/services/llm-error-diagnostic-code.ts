import { ApplicationError } from "../shared/errors.ts";

/** Returns a bounded machine-readable error code without exposing provider messages. */
export function llmErrorDiagnosticCode(error: unknown): string {
  if (error instanceof ApplicationError) {
    const details = error.details;
    if (details && typeof details === "object" && !Array.isArray(details)) {
      const providerErrorCode = (details as Record<string, unknown>).errorCode;
      if (typeof providerErrorCode === "string") return safeErrorCode(providerErrorCode);
    }
    return safeErrorCode(error.code);
  }
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return safeErrorCode(code);
  }
  return error instanceof Error ? safeErrorCode(error.name) : "UNKNOWN_ERROR";
}

function safeErrorCode(value: string): string {
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(value) ? value : "UNKNOWN_ERROR";
}
