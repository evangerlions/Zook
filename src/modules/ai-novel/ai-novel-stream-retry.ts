import { ApplicationError } from "../../shared/errors.ts";

export const AI_NOVEL_STREAM_MAX_ATTEMPTS = 2;

export interface AiNovelStreamRetryOptions<TChunk> {
  initiallyYielded?: boolean;
  resolveModelKey(excludedModelKeys: ReadonlySet<string>): Promise<string>;
  run(modelKey: string): AsyncIterable<TChunk>;
  shouldRetry(error: unknown): boolean;
  onRetry?(modelKey: string, error: unknown): void;
}

/**
 * Retries an AINovel stream at most once, and only before the first chunk is
 * yielded to the caller. The exclusion set is request-local and prevents a
 * stable DID+UID bucket from selecting the failed model again.
 */
export async function* streamWithAiNovelModelRetry<TChunk>(
  options: AiNovelStreamRetryOptions<TChunk>,
): AsyncIterable<TChunk> {
  const excludedModelKeys = new Set<string>();
  let hasYielded = options.initiallyYielded === true;
  let retrySourceError: unknown;

  for (let attempt = 0; attempt < AI_NOVEL_STREAM_MAX_ATTEMPTS; attempt += 1) {
    let modelKey: string | undefined;
    try {
      modelKey = await options.resolveModelKey(excludedModelKeys);
      for await (const chunk of options.run(modelKey)) {
        hasYielded = true;
        yield chunk;
      }
      return;
    } catch (error) {
      if (modelKey === undefined && retrySourceError !== undefined) {
        // No alternate model remained. Preserve the original upstream error
        // instead of replacing it with the selection-layer exhaustion error.
        throw retrySourceError;
      }
      const canRetry = modelKey !== undefined &&
        !hasYielded &&
        attempt + 1 < AI_NOVEL_STREAM_MAX_ATTEMPTS &&
        options.shouldRetry(error);
      if (!canRetry) {
        throw error;
      }
      retrySourceError = error;
      excludedModelKeys.add(modelKey);
      options.onRetry?.(modelKey, error);
    }
  }
}

export function isRetryableAiNovelStreamError(error: unknown): boolean {
  if (!(error instanceof ApplicationError)) {
    return false;
  }
  if (
    error.code === "LLM_ROUTE_NOT_AVAILABLE" ||
    error.code === "LLM_PROVIDER_RESPONSE_INVALID"
  ) {
    return true;
  }
  if (error.code !== "LLM_PROVIDER_REQUEST_FAILED") {
    return false;
  }

  const details = asRecord(error.details);
  const statusCode = readNumber(details.statusCode);
  const reason = readString(details.reason);
  return reason === "timeout" ||
    reason === "network_error" ||
    reason === "stream_first_event_timeout" ||
    reason === "first_byte_timeout" ||
    statusCode === 401 ||
    statusCode === 403 ||
    statusCode === 408 ||
    statusCode === 409 ||
    statusCode === 429 ||
    (statusCode !== undefined && statusCode >= 500);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
