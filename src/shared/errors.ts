import type { ErrorCode } from "./types.ts";

/**
 * ApplicationError keeps transport-level status and stable business codes together.
 */
export class ApplicationError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}

export function isApplicationError(error: unknown): error is ApplicationError {
  return error instanceof ApplicationError;
}

export function badRequest(code: ErrorCode, message: string, details?: unknown): never {
  throw new ApplicationError(400, code, message, details);
}

export function unauthorized(code: ErrorCode, message: string, details?: unknown): never {
  throw new ApplicationError(401, code, message, details);
}

export function forbidden(code: ErrorCode, message: string, details?: unknown): never {
  throw new ApplicationError(403, code, message, details);
}

export function conflict(code: ErrorCode, message: string, details?: unknown): never {
  throw new ApplicationError(409, code, message, details);
}

export function tooManyRequests(code: ErrorCode, message: string, details?: unknown): never {
  throw new ApplicationError(429, code, message, details);
}

export function payloadTooLarge(code: ErrorCode, message: string, details?: unknown): never {
  throw new ApplicationError(413, code, message, details);
}

export function internalError(message: string, details?: unknown): never {
  throw new ApplicationError(500, "SYS_INTERNAL_ERROR", message, details);
}
