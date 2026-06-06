import { isApplicationError } from "../../shared/errors.ts";

export function buildSmsProviderFailure(error: unknown): {
  providerRequestId?: string;
  providerMessage: string;
} {
  if (isApplicationError(error)) {
    const safeDetails = normalizeSmsProviderFailureDetails(error.details);
    return {
      providerRequestId:
        typeof safeDetails.requestId === "string" ? safeDetails.requestId : undefined,
      providerMessage: JSON.stringify({
        code: error.code,
        message: error.message,
        details: safeDetails,
      }),
    };
  }
  return {
    providerMessage: JSON.stringify({
      code: "UNKNOWN_ERROR",
      message: error instanceof Error ? error.message : String(error),
    }),
  };
}

function normalizeSmsProviderFailureDetails(details: unknown): Record<string, unknown> {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return {};
  }
  const source = details as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const key of ["provider", "missingField", "requestId"]) {
    if (source[key] !== undefined) {
      normalized[key] = source[key];
    }
  }
  const sendStatus = normalizeSmsProviderSendStatus(source.sendStatus);
  if (sendStatus) {
    normalized.sendStatus = sendStatus;
  }
  return normalized;
}

function normalizeSmsProviderSendStatus(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const key of ["Code", "Message", "SerialNo", "Fee", "IsoCode"]) {
    if (source[key] !== undefined) {
      normalized[key] = source[key];
    }
  }
  return Object.keys(normalized).length ? normalized : undefined;
}
