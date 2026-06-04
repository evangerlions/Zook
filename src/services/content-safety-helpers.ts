import { createHash } from "node:crypto";
import { ApplicationError } from "../shared/errors.ts";
import type { AdminContentSafetyTestDocument } from "../shared/types.ts";

export function normalizeSafetyText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export function hashContentSafetyText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function describeContentSafetyFailure(error: unknown): {
  reason: string;
  detail: string;
  errorName?: string;
  errorCode?: string;
  statusCode?: number;
} {
  if (error instanceof ApplicationError) {
    return {
      reason: error.code,
      detail: error.message,
      errorName: error.name,
      errorCode: error.code,
      statusCode: error.statusCode,
    };
  }
  if (error instanceof Error) {
    return {
      reason: error.name || "Error",
      detail: error.message,
      errorName: error.name,
    };
  }
  return {
    reason: "unknown_error",
    detail: String(error),
  };
}

export function isContentSafetyLayer(
  value: string,
): value is AdminContentSafetyTestDocument["layer"] {
  return [
    "disabled",
    "empty",
    "keyword",
    "llm",
    "aliyun",
    "failed_open",
  ].includes(value);
}

export function isLlmDebug(value: unknown): value is NonNullable<AdminContentSafetyTestDocument["llmDebug"]> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "input" in value);
}

export async function withContentSafetyTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("content safety LLM timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
