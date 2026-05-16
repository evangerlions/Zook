import assert from "node:assert/strict";
import test from "node:test";
import { RequestLoggingInterceptor } from "../../src/core/interceptors/request-logging.interceptor.ts";
import { StructuredLogger } from "../../src/infrastructure/logging/pino-logger.module.ts";
import type { HttpRequest, HttpResponse } from "../../src/shared/types.ts";

function createHealthRequest(): HttpRequest {
  return {
    method: "GET",
    path: "/api/health",
    headers: {},
    requestId: "req_health",
  };
}

function createResponse(statusCode = 200): HttpResponse<unknown> {
  return {
    statusCode,
    body: {
      code: "OK",
      message: "success",
      data: null,
      requestId: "req_health",
    },
  };
}

test("request logging interceptor throttles successful health logs to once every 20 minutes", () => {
  let now = 1_000;
  const logger = new StructuredLogger("api", { emitToConsole: false });
  const interceptor = new RequestLoggingInterceptor(logger, {
    now: () => now,
  });

  interceptor.log(createHealthRequest(), createResponse(), 0);
  assert.equal(logger.records.length, 1);

  now += 5 * 60 * 1000;
  interceptor.log(createHealthRequest(), createResponse(), 0);
  assert.equal(logger.records.length, 1);

  now += 20 * 60 * 1000;
  interceptor.log(createHealthRequest(), createResponse(), 0);
  assert.equal(logger.records.length, 2);
});

test("request logging interceptor still logs failed health checks immediately", () => {
  let now = 1_000;
  const logger = new StructuredLogger("api", { emitToConsole: false });
  const interceptor = new RequestLoggingInterceptor(logger, {
    now: () => now,
  });

  interceptor.log(createHealthRequest(), createResponse(500), 0, new Error("boom"));
  assert.equal(logger.records.length, 1);
  assert.equal(logger.records[0]?.message, "request failed");

  now += 5_000;
  interceptor.log(createHealthRequest(), createResponse(500), 0, new Error("boom-again"));
  assert.equal(logger.records.length, 2);
});

test("request logging interceptor does not throttle non-health requests", () => {
  const logger = new StructuredLogger("api", { emitToConsole: false });
  const interceptor = new RequestLoggingInterceptor(logger);
  const request: HttpRequest = {
    method: "POST",
    path: "/api/v1/auth/login",
    headers: {},
    requestId: "req_login",
    body: { appId: "app_a" },
  };
  const response: HttpResponse<unknown> = {
    statusCode: 200,
    body: {
      code: "OK",
      message: "success",
      data: null,
      requestId: "req_login",
    },
  };

  interceptor.log(request, response, 12);
  interceptor.log(request, response, 13);

  assert.equal(logger.records.length, 2);
  assert.equal(logger.records[0]?.path, "/api/v1/auth/login");
  assert.equal(logger.records[1]?.path, "/api/v1/auth/login");
});
