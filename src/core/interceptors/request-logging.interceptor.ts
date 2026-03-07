import { StructuredLogger } from "../../infrastructure/logging/pino-logger.module.ts";
import type { HttpRequest, HttpResponse } from "../../shared/types.ts";

/**
 * RequestLoggingInterceptor formats request completion logs in the JSON shape described by the doc.
 */
export class RequestLoggingInterceptor {
  constructor(private readonly logger: StructuredLogger) {}

  log(request: HttpRequest, response: HttpResponse<unknown>, latencyMs: number, error?: unknown): void {
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
}
