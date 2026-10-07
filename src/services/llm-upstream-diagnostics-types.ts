export const LLM_UPSTREAM_DIAGNOSTIC_ID_HEADER = "x-zook-diagnostic-id";

export interface LlmUpstreamFailureDiagnostic {
  diagnosticId: string;
  provider: string;
  modelKey: string;
  providerModel: string;
  requestedHost: string;
  lastCompletedStage: "request_started" | "response_headers" | "body_bytes" | "sse_event";
  responseHeadersMs?: number;
  firstBodyByteMs?: number;
  firstSseEventMs?: number;
  bodyBytes: number;
  sseEventCount: number;
  responseStatus?: number;
  providerRequestId?: string;
  elapsedMs: number;
  errorCode: string;
  errorReason?: string;
}

export interface LlmUpstreamDiagnostics {
  reportFailure(input: LlmUpstreamFailureDiagnostic): Promise<void> | void;
}
