import { createServer } from "node:http";
import { buildCorsHeaders, buildCorsPreflightHeaders, resolveCorsDecision } from "./infrastructure/http/cors.ts";
import { resolveClientAddress } from "./infrastructure/http/client-ip.ts";
import { readRequestBody } from "./infrastructure/http/request-body.ts";
import { init } from "./infrastructure/runtime/init.ts";
import { isTelemetryPath } from "./modules/telemetry/telemetry-gateway.ts";
import type { TelemetryGatewayResponse } from "./modules/telemetry/telemetry-gateway-types.ts";

function normalizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join(",") : value,
    ]),
  );
}

function writeTelemetryResponse(
  response: import("node:http").ServerResponse,
  handled: TelemetryGatewayResponse,
  origin?: string,
): void {
  response.statusCode = handled.statusCode;
  response.setHeader("X-Request-Id", handled.requestId);
  Object.entries(buildCorsHeaders(origin)).forEach(([key, value]) => response.setHeader(key, value));
  Object.entries(handled.headers ?? {}).forEach(([key, value]) => response.setHeader(key, value));
  response.end(handled.body ? Buffer.from(handled.body) : undefined);
}

const port = Number(process.env.PORT ?? 3100);
const runtime = await init({
  serviceName: "api",
  emitLogs: true,
});

const server = createServer(async (request, response) => {
  const requestCancellation = new AbortController();
  request.once("aborted", () => requestCancellation.abort());
  response.once("close", () => {
    if (!response.writableEnded) requestCancellation.abort();
  });
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const originHeader = Array.isArray(request.headers.origin) ? request.headers.origin[0] : request.headers.origin;
  const corsDecision = resolveCorsDecision(originHeader);

  if (!corsDecision.allowed) {
    response.statusCode = 403;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(
      JSON.stringify({
        code: "REQ_CORS_BLOCKED",
        message: `CORS blocked: ${corsDecision.origin}`,
        data: null,
        requestId: "req_cors_blocked",
      }),
    );
    return;
  }

  if ((request.method ?? "GET").toUpperCase() === "OPTIONS") {
    const requestedHeaders =
      Array.isArray(request.headers["access-control-request-headers"])
        ? request.headers["access-control-request-headers"][0]
        : request.headers["access-control-request-headers"];
    Object.entries(buildCorsPreflightHeaders(corsDecision.origin, requestedHeaders)).forEach(([key, value]) => {
      response.setHeader(key, value);
    });
    response.statusCode = 204;
    response.end();
    return;
  }

  try {
    const method = request.method ?? "GET";
    const normalizedHeaders = normalizeHeaders(request.headers);
    const clientAddress = resolveClientAddress(
      request.headers["x-forwarded-for"],
      request.socket.remoteAddress,
    );
    const ipAddress = clientAddress.ipAddress;
    if (isTelemetryPath(url.pathname)) {
      const handled = await runtime.telemetryGateway.handle({
        method,
        path: url.pathname,
        query: url.searchParams,
        headers: normalizedHeaders,
        body: request,
        discardBody: () => request.resume(),
        ipAddress,
        requestId: normalizedHeaders["x-request-id"],
      });
      writeTelemetryResponse(response, handled, corsDecision.origin);
      return;
    }

    const handled = await runtime.app.handle({
      method,
      path: url.pathname,
      headers: normalizedHeaders,
      query: Object.fromEntries(url.searchParams.entries()),
      body: await readRequestBody(
        request,
        Array.isArray(request.headers["content-type"])
          ? request.headers["content-type"][0]
          : request.headers["content-type"],
      ),
      hostname: request.headers.host?.split(":")[0],
      ipAddress,
      trustedProxy: clientAddress.trustedProxy,
      signal: requestCancellation.signal,
    });

    response.statusCode = handled.statusCode;
    response.setHeader("Content-Type", handled.contentType ?? "application/json; charset=utf-8");
    Object.entries(buildCorsHeaders(corsDecision.origin)).forEach(([key, value]) => {
      response.setHeader(key, value);
    });
    Object.entries(handled.headers ?? {}).forEach(([key, value]) => {
      response.setHeader(key, value);
    });
    if (handled.streamBody) {
      response.flushHeaders();
      try {
        for await (const chunk of handled.streamBody) {
          if (requestCancellation.signal.aborted) break;
          response.write(chunk);
        }
      } finally {
        if (!requestCancellation.signal.aborted) requestCancellation.abort();
      }
      if (!response.writableEnded && !response.destroyed) response.end();
      return;
    }

    response.end(JSON.stringify(handled.body));
  } catch (error) {
    if (response.destroyed) return;
    response.statusCode = 400;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    Object.entries(buildCorsHeaders(corsDecision.origin)).forEach(([key, value]) => {
      response.setHeader(key, value);
    });
    response.end(
      JSON.stringify({
        code: "REQ_INVALID_BODY",
        message: error instanceof Error ? error.message : "Invalid JSON body.",
        data: null,
        requestId: "req_invalid_json",
      }),
    );
  }
});

server.listen(port, () => {
  runtime.logger.info("api started", {
    path: "bootstrap",
    statusCode: 200,
  });
});
