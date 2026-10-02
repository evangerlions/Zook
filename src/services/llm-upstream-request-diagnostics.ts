import { randomUUID } from "node:crypto";
import { ApplicationError } from "../shared/errors.ts";
import { llmErrorDiagnosticCode } from "./llm-error-diagnostic-code.ts";
import {
  LLM_UPSTREAM_DIAGNOSTIC_ID_HEADER,
  type LlmUpstreamDiagnostics,
  type LlmUpstreamFailureDiagnostic,
} from "./llm-upstream-diagnostics-types.ts";

interface LlmUpstreamRequestDiagnosticsOptions {
  provider: string;
  modelKey: string;
  providerModel: string;
  requestUrl: string;
  diagnostics?: LlmUpstreamDiagnostics;
}

export interface LlmUpstreamRequestDiagnostics {
  diagnosticId: string;
  onResponse(response: Response): void;
  onBodyBytes(byteCount: number): void;
  onSseEvent(): void;
  reportFailure(error: unknown): void;
}

/** Tracks one provider stream attempt and reports a bounded failure summary. */
export function createLlmUpstreamRequestDiagnostics(
  options: LlmUpstreamRequestDiagnosticsOptions,
): LlmUpstreamRequestDiagnostics {
  const diagnosticId = randomUUID();
  const startedAt = performance.now();
  let lastCompletedStage: LlmUpstreamFailureDiagnostic["lastCompletedStage"] =
    "request_started";
  let responseHeadersMs: number | undefined;
  let firstBodyByteMs: number | undefined;
  let firstSseEventMs: number | undefined;
  let bodyBytes = 0;
  let sseEventCount = 0;
  let responseStatus: number | undefined;
  let providerRequestId: string | undefined;

  return {
    diagnosticId,
    onResponse(response) {
      responseStatus = response.status;
      responseHeadersMs = elapsedMs(startedAt);
      providerRequestId = readProviderRequestId(response.headers);
      lastCompletedStage = "response_headers";
    },
    onBodyBytes(byteCount) {
      bodyBytes += byteCount;
      firstBodyByteMs ??= elapsedMs(startedAt);
      lastCompletedStage = "body_bytes";
    },
    onSseEvent() {
      sseEventCount += 1;
      firstSseEventMs ??= elapsedMs(startedAt);
      lastCompletedStage = "sse_event";
    },
    reportFailure(error) {
      if (!options.diagnostics) return;
      const reason = readSafeErrorReason(error);
      const diagnostic: LlmUpstreamFailureDiagnostic = {
        diagnosticId,
        provider: options.provider,
        modelKey: options.modelKey,
        providerModel: options.providerModel,
        requestedHost: new URL(options.requestUrl).hostname,
        lastCompletedStage,
        ...(responseHeadersMs === undefined ? {} : { responseHeadersMs }),
        ...(firstBodyByteMs === undefined ? {} : { firstBodyByteMs }),
        ...(firstSseEventMs === undefined ? {} : { firstSseEventMs }),
        bodyBytes,
        sseEventCount,
        ...(responseStatus === undefined ? {} : { responseStatus }),
        ...(providerRequestId ? { providerRequestId } : {}),
        elapsedMs: elapsedMs(startedAt),
        errorCode: llmErrorDiagnosticCode(error),
        ...(reason ? { errorReason: reason } : {}),
      };
      try {
        void Promise.resolve(options.diagnostics.reportFailure(diagnostic)).catch(() => {});
      } catch {
        // Diagnostics must never affect the provider response or stream.
      }
    },
  };
}

export function buildUpstreamDiagnosticHeader(
  provider: string,
  diagnosticId: string,
): Record<string, string> {
  return provider === "bai" || provider === "openrouter"
    ? { [LLM_UPSTREAM_DIAGNOSTIC_ID_HEADER]: diagnosticId }
    : {};
}

function readSafeErrorReason(error: unknown): string | undefined {
  if (!(error instanceof ApplicationError) || !error.details || typeof error.details !== "object" || Array.isArray(error.details)) {
    return undefined;
  }
  const reason = (error.details as Record<string, unknown>).reason;
  return typeof reason === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(reason)
    ? reason
    : undefined;
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function readProviderRequestId(headers: Headers): string | undefined {
  for (const name of ["x-request-id", "request-id", "x-generation-id"]) {
    const value = headers.get(name)?.trim();
    if (value && /^[A-Za-z0-9._:-]{1,120}$/.test(value)) return value;
  }
  return undefined;
}
