import { badRequest } from "../../shared/errors.ts";

/**
 * ValidationPipe provides the minimal DTO-style validation needed by the local HTTP adapter.
 */
export class ValidationPipe {
  asObject(value: unknown): Record<string, unknown> {
    if (value === undefined) {
      return {};
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      badRequest("REQ_INVALID_BODY", "Request body must be a JSON object.");
    }

    return value as Record<string, unknown>;
  }

  requireString(container: Record<string, unknown>, key: string): string {
    const value = container[key];
    if (typeof value !== "string" || !value.trim()) {
      badRequest("REQ_INVALID_BODY", `${key} must be a non-empty string.`);
    }

    return value.trim();
  }

  optionalString(container: Record<string, unknown>, key: string): string | undefined {
    const value = container[key];
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    if (typeof value !== "string") {
      badRequest("REQ_INVALID_BODY", `${key} must be a string when provided.`);
    }

    return value.trim();
  }

  requireNumber(container: Record<string, unknown>, key: string): number {
    const value = container[key];
    if (typeof value !== "number" || Number.isNaN(value)) {
      badRequest("REQ_INVALID_BODY", `${key} must be a number.`);
    }

    return value;
  }

  requireArray<T>(container: Record<string, unknown>, key: string): T[] {
    const value = container[key];
    if (!Array.isArray(value)) {
      badRequest("REQ_INVALID_BODY", `${key} must be an array.`);
    }

    return value as T[];
  }

  requireQueryString(query: Record<string, string | undefined> | undefined, key: string): string {
    const value = query?.[key];
    if (!value) {
      badRequest("REQ_INVALID_QUERY", `${key} is required in the query string.`);
    }

    return value;
  }
}
