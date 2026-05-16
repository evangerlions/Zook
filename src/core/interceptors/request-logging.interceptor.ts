import { StructuredLogger } from "../../infrastructure/logging/pino-logger.module.ts";
import type { HttpRequest, HttpResponse } from "../../shared/types.ts";

/**
 * RequestLoggingInterceptor formats request completion logs in the JSON shape described by the doc.
 */
export class RequestLoggingInterceptor {
  private readonly healthLogIntervalMs: number;
  private lastHealthSuccessLogAt = 0;

  constructor(
    private readonly logger: StructuredLogger,
    options: {
      now?: () => number;
      healthLogIntervalMs?: number;
    } = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.healthLogIntervalMs = options.healthLogIntervalMs ?? 20 * 60 * 1000;
  }

  private readonly now: () => number;

  log(request: HttpRequest, response: HttpResponse<unknown>, latencyMs: number, error?: unknown): void {
    if (this.shouldSkipHealthSuccessLog(request, response, error)) {
      return;
    }

    const appId =
      request.auth?.appId ??
      request.query?.appId ??
      (request.body &&
      typeof request.body === "object" &&
      !Array.isArray(request.body) &&
      typeof request.body.appId === "string"
        ? request.body.appId
        : undefined);

    const message = error ? "request failed" : "request completed";
    const level = response.statusCode >= 500 ? "error" : "info";
    this.logger[level](message, {
      requestId: request.requestId,
      appId,
      userId: request.auth?.userId,
      path: request.path,
      statusCode: response.statusCode,
      latencyMs,
      error: error instanceof Error ? error.message : undefined,
    });
  }

  private shouldSkipHealthSuccessLog(
    request: HttpRequest,
    response: HttpResponse<unknown>,
    error?: unknown,
  ): boolean {
    if (request.method !== "GET" || request.path != "/api/health" || error || response.statusCode !== 200) {
      return false;
    }

    const now = this.now();
    if (this.lastHealthSuccessLogAt === 0 || now - this.lastHealthSuccessLogAt >= this.healthLogIntervalMs) {
      this.lastHealthSuccessLogAt = now;
      return false;
    }

    return true;
  }
}
