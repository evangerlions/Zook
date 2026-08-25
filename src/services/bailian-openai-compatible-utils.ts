import { createHash } from "node:crypto";
import { ApplicationError } from "../shared/errors.ts";
import {
  DEFAULT_STREAM_FIRST_EVENT_TIMEOUT_MS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  type OpenAICompatibleEmbeddingPayload,
  type OpenAICompatibleResponsePayload,
  type StreamTimeoutOptions,
} from "./bailian-openai-compatible-types.ts";

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

export function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function readOptionalNonBlankString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function buildFallbackToolCallId(modelKey: string, index: number): string {
  return `${modelKey}_tool_${index}`;
}

export function resolveStreamTimeouts(
  streamOptions: Record<string, unknown> | undefined,
): Required<StreamTimeoutOptions> {
  return {
    firstEventTimeoutMs: readPositiveInteger(
      streamOptions?.first_event_timeout_ms,
      DEFAULT_STREAM_FIRST_EVENT_TIMEOUT_MS,
    ),
    idleTimeoutMs: readPositiveInteger(
      streamOptions?.idle_timeout_ms,
      DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    ),
  };
}

export function throwProviderRequestFailed(
  statusCode: number,
  payload: OpenAICompatibleResponsePayload,
  provider = "bailian",
): never {
  if (isDataInspectionFailure(payload)) {
    throwContentInspectionFailure(statusCode, payload, provider);
  }

  const errorMessage =
    payload.error?.message ??
    payload.message ??
    `${provider} request failed with status ${statusCode}.`;

  throw new ApplicationError(
    502,
    "LLM_PROVIDER_REQUEST_FAILED",
    errorMessage,
    {
      provider,
      statusCode,
      errorCode: payload.error?.code,
      errorType: payload.error?.type,
      providerRequestId: payload.request_id ?? payload.id,
    },
  );
}

export function throwEmbeddingRequestFailed(
  statusCode: number,
  payload: OpenAICompatibleEmbeddingPayload,
  provider = "bailian",
): never {
  if (isDataInspectionFailure(payload)) {
    throwContentInspectionFailure(statusCode, payload, provider);
  }
  const errorMessage =
    payload.error?.message ??
    payload.message ??
    `${provider} embedding request failed with status ${statusCode}.`;

  throw new ApplicationError(
    502,
    "LLM_PROVIDER_REQUEST_FAILED",
    errorMessage,
    {
      provider,
      statusCode,
      errorCode: payload.error?.code,
      errorType: payload.error?.type,
      providerRequestId: payload.request_id ?? payload.id,
    },
  );
}

export function throwProviderResponseInvalid(
  message: string,
  details?: unknown,
  provider = "bailian",
): never {
  throw new ApplicationError(502, "LLM_PROVIDER_RESPONSE_INVALID", message, {
    provider,
    ...toRecord(details),
  });
}

export function redactProviderRequestBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...body,
    ...(Array.isArray(body.messages)
      ? {
          messages: body.messages.map((message) =>
            redactProviderLogMessage(message),
          ),
        }
      : {}),
  };
}

function isDataInspectionFailure(
  payload: OpenAICompatibleResponsePayload | OpenAICompatibleEmbeddingPayload,
): boolean {
  const values = [
    payload.error?.code,
    payload.error?.type,
    payload.message,
    payload.error?.message,
  ]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLowerCase());

  return values.some(
    (value) =>
      value === "data_inspection_failed" ||
      value === "datainspectionfailed" ||
      value.includes("data inspection failed") ||
      value.includes("data_inspection_failed"),
  );
}

function throwContentInspectionFailure(
  statusCode: number,
  payload: OpenAICompatibleResponsePayload | OpenAICompatibleEmbeddingPayload,
  provider: string,
): never {
  throw new ApplicationError(
    400,
    "LLM_PROVIDER_CONTENT_SENSITIVE",
    payload.error?.message ?? payload.message ?? `${provider} content inspection rejected the request.`,
    {
      provider,
      statusCode,
      errorCode: payload.error?.code,
      errorType: payload.error?.type,
      providerRequestId: payload.request_id ?? payload.id,
    },
  );
}

function readPositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function toRecord(details: unknown): Record<string, unknown> {
  return isRecord(details) ? details : {};
}

function redactProviderLogMessage(message: unknown): unknown {
  if (!isRecord(message)) {
    return message;
  }
  const content = message.content;
  if (typeof content !== "string") {
    return message;
  }
  return {
    ...message,
    content: "[redacted]",
    contentLength: content.length,
    contentHash: createHash("sha256").update(content, "utf8").digest("hex"),
  };
}
