import { randomId } from "../../shared/utils.ts";
import type { StructuredLogger } from "../../infrastructure/logging/pino-logger.module.ts";
import { TelemetryRateLimiter } from "./telemetry-rate-limiter.ts";
import type {
  TelemetryGatewayConfig,
  TelemetryGatewayRequest,
  TelemetryGatewayResponse,
  TelemetryLane,
} from "./telemetry-gateway-types.ts";

const GA4_PATH = "/telemetry/ga4";
const GA4_MAX_BODY_BYTES = 130_000;
const SENTRY_MAX_BODY_BYTES = 1024 * 1024;
const MAX_UPSTREAM_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_BODY_TIMEOUT_MS = 5_000;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 120;
const GA4_COLLECT_URL = "https://www.google-analytics.com/mp/collect";
const SENTRY_PATH_PATTERN = /^\/telemetry\/sentry\/api\/([^/]+)\/envelope\/?$/;
const SENTRY_CONTENT_TYPES = new Set([
  "application/octet-stream",
  "application/x-sentry-envelope",
  "text/plain",
]);

class TelemetryBodyTooLargeError extends Error {}
class TelemetryBodyTimeoutError extends Error {}
class TelemetryUpstreamTimeoutError extends Error {}
class TelemetryUpstreamResponseTooLargeError extends Error {}

type TelemetryRoute =
  | { lane: "ga4"; maxBodyBytes: number }
  | { lane: "sentry"; maxBodyBytes: number; projectId: string };

type UpstreamRequest = { url: URL; headers: Record<string, string> };
type UpstreamResolution =
  | { request: UpstreamRequest }
  | { statusCode: number };

export function isTelemetryPath(path: string): boolean {
  return path === "/telemetry" || path.startsWith("/telemetry/");
}

export class TelemetryGateway {
  private readonly timeoutMs: number;
  private readonly bodyTimeoutMs: number;
  private readonly limiter: TelemetryRateLimiter;

  constructor(
    private readonly config: TelemetryGatewayConfig,
    private readonly logger: StructuredLogger,
    private readonly fetchImplementation: typeof fetch = globalThis.fetch,
  ) {
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.bodyTimeoutMs = config.bodyTimeoutMs ?? DEFAULT_BODY_TIMEOUT_MS;
    this.limiter = new TelemetryRateLimiter(
      config.rateLimitPerMinute ?? DEFAULT_RATE_LIMIT_PER_MINUTE,
    );
  }

  async handle(request: TelemetryGatewayRequest): Promise<TelemetryGatewayResponse> {
    const requestId = safeRequestId(request.requestId) ?? randomId("req");
    const startedAt = Date.now();
    const rejectBeforeBody = (
      lane: TelemetryLane,
      statusCode: number,
      headers?: Record<string, string>,
    ) => {
      request.discardBody?.();
      return this.finish(lane, request.path, requestId, startedAt, statusCode, 0, {
        ...headers,
        Connection: "close",
      });
    };
    const route = this.resolveRoute(request.path);
    if (!route) {
      const lane = request.path.startsWith("/telemetry/sentry/") ? "sentry" : "ga4";
      return rejectBeforeBody(lane, 404);
    }
    if (request.method.toUpperCase() !== "POST") {
      return rejectBeforeBody(route.lane, 405, {
        Allow: "POST",
      });
    }

    const rateLimitKey = `${route.lane}:${request.ipAddress ?? "unknown"}`;
    if (!this.limiter.allow(rateLimitKey)) {
      return rejectBeforeBody(route.lane, 429, {
        "Retry-After": "60",
      });
    }

    if (
      !this.isSupportedContentType(route.lane, request.headers["content-type"]) ||
      !this.isSupportedContentEncoding(route.lane, request.headers["content-encoding"])
    ) {
      return rejectBeforeBody(route.lane, 415);
    }

    try {
      const upstream = this.resolveUpstreamRequest(route, request);
      if ("statusCode" in upstream) {
        return rejectBeforeBody(route.lane, upstream.statusCode);
      }

      const body = await readLimitedBody(
        request.body,
        route.maxBodyBytes,
        this.bodyTimeoutMs,
      );
      const { response: upstreamResponse, body: responseBody } = await this.forward(
        upstream.request.url,
        upstream.request.headers,
        body,
      );
      const responseHeaders = copyResponseHeaders(upstreamResponse.headers);
      return this.finish(
        route.lane,
        request.path,
        requestId,
        startedAt,
        upstreamResponse.status,
        body.byteLength,
        responseHeaders,
        undefined,
        responseBody,
      );
    } catch (error) {
      const statusCode = error instanceof TelemetryBodyTooLargeError
        ? 413
        : error instanceof TelemetryBodyTimeoutError
          ? 408
          : error instanceof TelemetryUpstreamResponseTooLargeError
            ? 502
        : error instanceof TelemetryUpstreamTimeoutError || isAbortError(error)
          ? 504
          : 502;
      const failureCode = statusCode === 504
        ? "upstream_timeout"
        : statusCode === 502
          ? "upstream_network_error"
          : undefined;
      if (
        error instanceof TelemetryBodyTooLargeError ||
        error instanceof TelemetryBodyTimeoutError
      ) {
        request.discardBody?.();
      }
      return this.finish(
        route.lane,
        request.path,
        requestId,
        startedAt,
        statusCode,
        0,
        statusCode === 408 || statusCode === 413
          ? { Connection: "close" }
          : undefined,
        failureCode,
      );
    }
  }

  private resolveRoute(path: string): TelemetryRoute | undefined {
    if (path === GA4_PATH) {
      return { lane: "ga4" as const, maxBodyBytes: GA4_MAX_BODY_BYTES };
    }
    const sentryMatch = path.match(SENTRY_PATH_PATTERN);
    if (sentryMatch) {
      return {
        lane: "sentry" as const,
        maxBodyBytes: SENTRY_MAX_BODY_BYTES,
        projectId: sentryMatch[1] as string,
      };
    }
    return undefined;
  }

  private isSupportedContentType(lane: TelemetryLane, header?: string): boolean {
    const contentType = header?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (lane === "ga4") {
      return contentType === "application/json";
    }
    return SENTRY_CONTENT_TYPES.has(contentType);
  }

  private isSupportedContentEncoding(lane: TelemetryLane, header?: string): boolean {
    const encoding = header?.trim().toLowerCase() ?? "";
    return !encoding || encoding === "identity" || (lane === "sentry" && encoding === "gzip");
  }

  private resolveUpstreamRequest(
    route: TelemetryRoute,
    request: TelemetryGatewayRequest,
  ): UpstreamResolution {
    if (route.lane === "ga4") {
      const destination = this.config.ga4;
      if (!destination?.measurementId || !destination.apiSecret) {
        return { statusCode: 503 };
      }
      const url = new URL(GA4_COLLECT_URL);
      url.searchParams.set("measurement_id", destination.measurementId);
      url.searchParams.set("api_secret", destination.apiSecret);
      return { request: { url, headers: { "Content-Type": "application/json" } } };
    }

    const destination = this.config.sentry;
    if (!destination?.projectId || !destination.publicKey || !destination.ingestOrigin) {
      return { statusCode: 503 };
    }
    if (route.projectId !== destination.projectId) {
      return { statusCode: 404 };
    }
    if (!hasExpectedSentryKey(request, destination.publicKey)) {
      return { statusCode: 403 };
    }

    const ingestOrigin = normalizeOrigin(destination.ingestOrigin);
    if (!ingestOrigin) {
      return { statusCode: 503 };
    }
    const url = new URL(`/api/${encodeURIComponent(destination.projectId)}/envelope/`, ingestOrigin);
    copySentryQuery(request.query, url.searchParams);
    const headers = copySentryRequestHeaders(request.headers);
    return { request: { url, headers } };
  }

  private async forward(
    url: URL,
    headers: Record<string, string>,
    body: Buffer,
  ): Promise<{ response: Response; body: Buffer }> {
    const controller = new AbortController();
    const deadline = Date.now() + this.timeoutMs;
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImplementation(url, {
        method: "POST",
        headers,
        body,
        redirect: "error",
        signal: controller.signal,
      });
      const responseBody = await readLimitedResponseBody(
        response,
        MAX_UPSTREAM_RESPONSE_BYTES,
        deadline,
      );
      return { response, body: responseBody };
    } finally {
      clearTimeout(timeout);
    }
  }

  private finish(
    lane: TelemetryLane,
    path: string,
    requestId: string,
    startedAt: number,
    statusCode: number,
    byteCount: number,
    headers?: Record<string, string>,
    failureCode?: string,
    body: Uint8Array = new Uint8Array(),
  ): TelemetryGatewayResponse {
    const context = {
      requestId,
      path,
      httpStatus: statusCode,
      latencyMs: Date.now() - startedAt,
      telemetryLane: lane,
      byteCount,
      error: failureCode,
    };
    if (statusCode >= 500) {
      this.logger.warn("telemetry proxy request failed", context);
    } else {
      this.logger.info("telemetry proxy request completed", context);
    }
    return { statusCode, headers, body, requestId };
  }
}

async function readLimitedBody(
  source: AsyncIterable<Uint8Array>,
  maxBytes: number,
  timeoutMs: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let byteCount = 0;
  const iterator = source[Symbol.asyncIterator]();
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new TelemetryBodyTimeoutError();
    }
    const next = await nextBodyChunk(iterator, remainingMs);
    if (next.done) {
      break;
    }
    const chunk = next.value;
    byteCount += chunk.byteLength;
    if (byteCount > maxBytes) {
      throw new TelemetryBodyTooLargeError();
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function nextBodyChunk(
  iterator: AsyncIterator<Uint8Array>,
  timeoutMs: number,
): Promise<IteratorResult<Uint8Array>> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new TelemetryBodyTimeoutError()),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function readLimitedResponseBody(
  response: Response,
  maxBytes: number,
  deadline: number,
): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new TelemetryUpstreamResponseTooLargeError();
  }
  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let byteCount = 0;
  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      void reader.cancel().catch(() => undefined);
      throw new TelemetryUpstreamTimeoutError();
    }
    const next = await nextResponseChunk(reader, remainingMs);
    if (next.done) {
      return Buffer.concat(chunks);
    }
    byteCount += next.value.byteLength;
    if (byteCount > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new TelemetryUpstreamResponseTooLargeError();
    }
    chunks.push(Buffer.from(next.value));
  }
}

async function nextResponseChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new TelemetryUpstreamTimeoutError());
          void reader.cancel().catch(() => undefined);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

function hasExpectedSentryKey(request: TelemetryGatewayRequest, expected: string): boolean {
  const keys: string[] = [];
  const queryKey = request.query.get("sentry_key");
  if (queryKey) {
    keys.push(queryKey);
  }
  const authHeader = request.headers["x-sentry-auth"];
  const headerKey = authHeader?.match(/(?:^|[ ,])sentry_key=([^, ]+)/)?.[1];
  if (headerKey) {
    keys.push(headerKey);
  }
  return keys.length > 0 && keys.every((key) => key === expected);
}

function copySentryQuery(source: URLSearchParams, target: URLSearchParams): void {
  for (const key of ["sentry_key", "sentry_version", "sentry_client"]) {
    const value = source.get(key);
    if (value) {
      target.set(key, value);
    }
  }
}

function copySentryRequestHeaders(headers: Record<string, string | undefined>): Record<string, string> {
  const copied: Record<string, string> = {};
  const contentType = headers["content-type"];
  const contentEncoding = headers["content-encoding"];
  const sentryAuth = headers["x-sentry-auth"];
  if (contentType) copied["Content-Type"] = contentType;
  if (contentEncoding) copied["Content-Encoding"] = contentEncoding;
  if (sentryAuth) copied["X-Sentry-Auth"] = sentryAuth;
  return copied;
}

function copyResponseHeaders(headers: Headers): Record<string, string> {
  const copied: Record<string, string> = {};
  for (const key of ["content-type", "retry-after", "x-sentry-rate-limits"]) {
    const value = headers.get(key);
    if (value) {
      copied[key] = value;
    }
  }
  return copied;
}

function safeRequestId(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(trimmed)
    ? trimmed
    : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
