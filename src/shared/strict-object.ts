import { ApplicationError } from "./errors.ts";

export function strictObject(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new ApplicationError(400, "REQ_INVALID_BODY", "Invalid object or unknown fields.");
  }
  return value as Record<string, unknown>;
}
