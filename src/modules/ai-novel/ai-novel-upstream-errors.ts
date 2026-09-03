import { ApplicationError } from "../../shared/errors.ts";
import {
  describeUnknownError,
  previewLogValue,
} from "../../shared/error-diagnostics.ts";
import type { StructuredLogger } from "../../infrastructure/logging/pino-logger.module.ts";
import type { ErrorCode } from "../../shared/types.ts";
import { AI_NOVEL_APP_ID } from "./ai-novel-constants.ts";
import type { AiNovelPromptProfile } from "./ai-novel-llm-prompts.ts";

export function mapAndLogAiNovelUpstreamError(
  error: unknown,
  context: {
    stage: "chat" | "chat_stream" | "embedding";
    requestId?: string;
    sceneKey: string;
    sceneRouteKey: string;
    profile?: AiNovelPromptProfile;
  },
  logger?: StructuredLogger,
): unknown {
  const mapped = mapAiNovelUpstreamError(error);
  const original = error instanceof ApplicationError ? error : undefined;
  const mappedError = mapped instanceof ApplicationError ? mapped : undefined;

  logger?.error("ai_novel upstream request failed", {
    requestId: context.requestId,
    appId: AI_NOVEL_APP_ID,
    stage: context.stage,
    sceneKey: context.sceneKey,
    sceneRouteKey: context.sceneRouteKey,
    ...(context.profile ? { profile: context.profile } : {}),
    originalStatusCode: original?.statusCode,
    originalCode: original?.code,
    originalMessage: original?.message,
    mappedStatusCode: mappedError?.statusCode,
    mappedCode: mappedError?.code,
    mappedMessage: mappedError?.message,
    ...extractUpstreamErrorDetails(original?.details),
    originalDetailsPreview: previewLogValue(original?.details),
    ...describeUnknownError(error, "original"),
    ...describeUnknownError(mapped, "mapped"),
  });

  return mapped;
}

function mapAiNovelUpstreamError(error: unknown): unknown {
  if (!(error instanceof ApplicationError)) {
    return error;
  }

  if (error.code === "LLM_PROVIDER_REQUEST_FAILED") {
    if (
      error.statusCode === 504 ||
      getDetailString(error.details, "reason") === "timeout"
    ) {
      return new ApplicationError(
        504,
        "AI_UPSTREAM_TIMEOUT",
        "Upstream model service timed out.",
        error.details,
      );
    }

    const providerFailure = classifyProviderRequestFailure(error);
    return new ApplicationError(
      providerFailure.statusCode,
      providerFailure.code,
      error.message,
      error.details,
    );
  }

  if (error.code === "LLM_PROVIDER_RESPONSE_INVALID") {
    return new ApplicationError(
      502,
      "AI_UPSTREAM_RESPONSE_INVALID",
      error.message,
      error.details,
    );
  }

  if (
    error.code === "LLM_ROUTE_NOT_AVAILABLE" ||
    error.code === "LLM_SERVICE_NOT_CONFIGURED" ||
    error.code === "LLM_MODEL_NOT_FOUND"
  ) {
    return new ApplicationError(
      502,
      "AI_UPSTREAM_CONFIG_INVALID",
      error.message,
      error.details,
    );
  }

  return error;
}

function classifyProviderRequestFailure(error: ApplicationError): {
  code: ErrorCode;
  statusCode: number;
} {
  const providerStatusCode =
    getDetailNumber(error.details, "statusCode") ?? error.statusCode;
  const providerErrorCode = getDetailString(error.details, "errorCode");
  const providerErrorType = getDetailString(error.details, "errorType");
  const upstreamReason = getDetailString(error.details, "reason");
  const searchText = [
    providerErrorCode,
    providerErrorType,
    upstreamReason,
    error.message,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  if (
    includesAny(searchText, [
      "context_length_exceeded",
      "context length exceeded",
      "context window exceeded",
      "exceeds the context window",
      "input is too long",
      "maximum context length",
      "too many tokens",
    ])
  ) {
    return { code: "AI_CONTEXT_TOO_LONG", statusCode: 413 };
  }
  if (
    providerStatusCode === 401 ||
    providerStatusCode === 403 ||
    includesAny(searchText, [
      "accessdenied",
      "authentication",
      "forbidden",
      "invalid_api_key",
      "unauthorized",
    ])
  ) {
    return { code: "AI_UPSTREAM_AUTH_FAILED", statusCode: 502 };
  }
  if (
    includesAny(searchText, [
      "balance",
      "billing",
      "insufficient balance",
      "insufficient funds",
      "insufficient_quota",
      "quota",
    ])
  ) {
    return { code: "AI_UPSTREAM_QUOTA_EXHAUSTED", statusCode: 503 };
  }
  if (
    providerStatusCode === 429 ||
    includesAny(searchText, ["rate_limit", "ratelimit", "throttl"])
  ) {
    return { code: "AI_UPSTREAM_RATE_LIMITED", statusCode: 429 };
  }
  if (
    providerStatusCode === 400 ||
    includesAny(searchText, [
      "bad_request",
      "badrequest",
      "invalid_parameter",
      "invalid_request",
      "request body",
    ])
  ) {
    return { code: "AI_UPSTREAM_INVALID_REQUEST", statusCode: 502 };
  }
  return { code: "AI_UPSTREAM_BAD_GATEWAY", statusCode: 502 };
}

function extractUpstreamErrorDetails(details: unknown): Record<string, unknown> {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return {};
  }
  const value = details as Record<string, unknown>;
  return {
    provider: value.provider,
    providerStatusCode: value.statusCode,
    providerErrorCode: value.errorCode,
    providerErrorType: value.errorType,
    providerRequestId: value.providerRequestId,
    upstreamReason: value.reason,
    upstreamCause: value.cause,
    timeoutMs: value.timeoutMs,
  };
}

function getDetailString(details: unknown, key: string): string | undefined {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return undefined;
  }
  const value = (details as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function getDetailNumber(details: unknown, key: string): number | undefined {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return undefined;
  }
  const value = (details as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}
