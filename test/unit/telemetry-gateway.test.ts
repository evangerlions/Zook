import assert from "node:assert/strict";
import test from "node:test";

import { StructuredLogger } from "../../src/infrastructure/logging/pino-logger.module.ts";
import {
  isTelemetryPath,
  TelemetryGateway,
} from "../../src/modules/telemetry/telemetry-gateway.ts";
import type {
  TelemetryGatewayConfig,
  TelemetryGatewayRequest,
} from "../../src/modules/telemetry/telemetry-gateway-types.ts";

const completeConfig: TelemetryGatewayConfig = {
  ga4: {
    measurementId: "G-ORANGEWRITE",
    apiSecret: "server-only-secret",
  },
  sentry: {
    projectId: "42",
    publicKey: "public-key",
    ingestOrigin: "https://example.ingest.sentry.io",
  },
};

test("GA4 forwarding preserves official payload bytes and injects server credentials", async () => {
  const payload = Buffer.from('{"client_id":"123.456","events":[{"name":"app_open"}]}');
  const calls: Array<{ url: URL; body: Buffer }> = [];
  const { gateway, logger } = createGateway(completeConfig, async (input, init) => {
    calls.push({
      url: new URL(String(input)),
      body: Buffer.from(init?.body as Uint8Array),
    });
    return new Response(null, { status: 204 });
  });

  const response = await gateway.handle(createRequest({
    path: "/telemetry/ga4",
    contentType: "application/json; charset=utf-8",
    body: payload,
  }));

  assert.equal(response.statusCode, 204);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.body, payload);
  assert.equal(calls[0]?.url.origin, "https://www.google-analytics.com");
  assert.equal(calls[0]?.url.searchParams.get("measurement_id"), "G-ORANGEWRITE");
  assert.equal(calls[0]?.url.searchParams.get("api_secret"), "server-only-secret");
  assert.equal(logger.records[0]?.httpStatus, 204);
  assert.equal(JSON.stringify(logger.records).includes("server-only-secret"), false);
  assert.equal(JSON.stringify(logger.records).includes(payload.toString()), false);
});

test("Sentry forwarding preserves SDK gzip bytes, auth, response body, and headers", async () => {
  const envelope = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02, 0x03]);
  let capturedUrl: URL | undefined;
  let capturedBody: Buffer | undefined;
  let capturedHeaders: Headers | undefined;
  const { gateway } = createGateway(completeConfig, async (input, init) => {
    capturedUrl = new URL(String(input));
    capturedBody = Buffer.from(init?.body as Uint8Array);
    capturedHeaders = new Headers(init?.headers);
    return new Response('{"id":"accepted-event"}', {
      status: 200,
      headers: {
        "content-type": "application/json",
        "retry-after": "10",
        "x-sentry-rate-limits": "10:error",
      },
    });
  });

  const response = await gateway.handle(createRequest({
    path: "/telemetry/sentry/api/42/envelope/",
    query: new URLSearchParams({ ignored: "not-forwarded" }),
    contentType: "application/x-sentry-envelope",
    contentEncoding: "gzip",
    sentryAuth: "Sentry sentry_version=7, sentry_key=public-key, sentry_client=sentry.dart/9.27.0",
    body: envelope,
  }));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(capturedBody, envelope);
  assert.equal(capturedUrl?.origin, "https://example.ingest.sentry.io");
  assert.equal(capturedUrl?.pathname, "/api/42/envelope/");
  assert.equal(capturedUrl?.searchParams.has("ignored"), false);
  assert.equal(capturedHeaders?.get("content-encoding"), "gzip");
  assert.match(capturedHeaders?.get("x-sentry-auth") ?? "", /sentry_key=public-key/);
  assert.equal(response.headers?.["content-type"], "application/json");
  assert.equal(response.headers?.["retry-after"], "10");
  assert.equal(response.headers?.["x-sentry-rate-limits"], "10:error");
  assert.equal(Buffer.from(response.body ?? []).toString(), '{"id":"accepted-event"}');
});

test("Sentry forwarding accepts the OpenAPI path without a trailing slash", async () => {
  let fetchCount = 0;
  const { gateway } = createGateway(completeConfig, async () => {
    fetchCount += 1;
    return new Response(null, { status: 200 });
  });

  const response = await gateway.handle(createRequest({
    path: "/telemetry/sentry/api/42/envelope",
    query: new URLSearchParams({ sentry_key: "public-key" }),
    contentType: "application/x-sentry-envelope",
  }));

  assert.equal(response.statusCode, 200);
  assert.equal(fetchCount, 1);
});

test("gateway rejects unavailable and non-allowlisted destinations before reading the body", async () => {
  let fetchCount = 0;
  const fakeFetch = async () => {
    fetchCount += 1;
    return new Response(null, { status: 204 });
  };
  const unavailable = createGateway({}, fakeFetch).gateway;
  const configured = createGateway(completeConfig, fakeFetch).gateway;

  const gaUnavailable = await unavailable.handle(createRequest({ path: "/telemetry/ga4" }));
  const sentryUnknown = await configured.handle(createRequest({
    path: "/telemetry/sentry/api/99/envelope/",
    query: new URLSearchParams({ sentry_key: "public-key" }),
    contentType: "application/x-sentry-envelope",
  }));
  const sentryUnauthorized = await configured.handle(createRequest({
    path: "/telemetry/sentry/api/42/envelope/",
    query: new URLSearchParams({ sentry_key: "wrong-key" }),
    contentType: "application/x-sentry-envelope",
  }));

  assert.equal(gaUnavailable.statusCode, 503);
  assert.equal(sentryUnknown.statusCode, 404);
  assert.equal(sentryUnauthorized.statusCode, 403);
  assert.equal(fetchCount, 0);
});

test("gateway enforces method, content type, body size, and local rate limit", async () => {
  const fakeFetch = async () => new Response(null, { status: 204 });
  const { gateway } = createGateway({ ...completeConfig, rateLimitPerMinute: 1 }, fakeFetch);

  const methodRejected = await gateway.handle(createRequest({ method: "GET" }));
  const typeRejected = await gateway.handle(createRequest({ contentType: "text/plain" }));
  const encodingRejected = await gateway.handle(createRequest({
    contentEncoding: "br",
    ipAddress: "encoding-ip",
  }));
  const missingSentryType = await gateway.handle(createRequest({
    path: "/telemetry/sentry/api/42/envelope/",
    contentType: null,
    sentryAuth: "Sentry sentry_version=7, sentry_key=public-key",
    ipAddress: "missing-type-ip",
  }));
  const accepted = await gateway.handle(createRequest({ ipAddress: "second-ip" }));
  const throttled = await gateway.handle(createRequest({ ipAddress: "second-ip" }));
  const oversized = await createGateway(completeConfig, fakeFetch).gateway.handle(createRequest({
    body: Buffer.alloc(130_001),
  }));

  assert.equal(methodRejected.statusCode, 405);
  assert.equal(typeRejected.statusCode, 415);
  assert.equal(encodingRejected.statusCode, 415);
  assert.equal(missingSentryType.statusCode, 415);
  assert.equal(accepted.statusCode, 204);
  assert.equal(throttled.statusCode, 429);
  assert.equal(throttled.headers?.["Retry-After"], "60");
  assert.equal(oversized.statusCode, 413);
});

test("gateway discards early request bodies and bounds receive time", async () => {
  let discardCount = 0;
  const unavailable = createGateway({}, async () => new Response(null, { status: 204 })).gateway;
  const rejected = await unavailable.handle(createRequest({
    discardBody: () => { discardCount += 1; },
  }));
  const timeout = createGateway(
    { ...completeConfig, bodyTimeoutMs: 1 },
    async () => new Response(null, { status: 204 }),
  ).gateway;
  const timedOut = await timeout.handle(createRequest({
    bodyStream: neverEndingBody(),
    discardBody: () => { discardCount += 1; },
  }));

  assert.equal(rejected.statusCode, 503);
  assert.equal(rejected.headers?.Connection, "close");
  assert.equal(timedOut.statusCode, 408);
  assert.equal(timedOut.headers?.Connection, "close");
  assert.equal(discardCount, 2);
});

test("gateway replaces unsafe client request ids before logging", async () => {
  const { gateway, logger } = createGateway({}, async () => new Response(null));
  const response = await gateway.handle(createRequest({
    requestId: "private prompt with spaces",
  }));

  assert.match(response.requestId, /^req_[A-Za-z0-9]+$/);
  assert.equal(JSON.stringify(logger.records).includes("private prompt"), false);
});

test("gateway maps upstream network failures and timeouts without throwing", async () => {
  const networkFailure = createGateway(completeConfig, async () => {
    throw new Error("network unavailable");
  }).gateway;
  const timeout = createGateway({ ...completeConfig, timeoutMs: 1 }, async (_input, init) => {
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("timed out", "AbortError"));
      });
    });
  }).gateway;

  assert.equal((await networkFailure.handle(createRequest())).statusCode, 502);
  assert.equal((await timeout.handle(createRequest())).statusCode, 504);
});

test("gateway times out when upstream response headers arrive but its body stalls", async () => {
  const stalledBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
    },
  });
  const gateway = createGateway(
    { ...completeConfig, timeoutMs: 10 },
    async () => new Response(stalledBody, { status: 200 }),
  ).gateway;

  const response = await gateway.handle(createRequest());

  assert.equal(response.statusCode, 504);
});

test("telemetry path matching keeps the gateway outside normal application routes", () => {
  assert.equal(isTelemetryPath("/telemetry/ga4"), true);
  assert.equal(isTelemetryPath("/telemetry/sentry/api/42/envelope/"), true);
  assert.equal(isTelemetryPath("/api/v1/analytics/events/batch"), false);
  assert.equal(isTelemetryPath("/api/health"), false);
});

function createGateway(
  config: TelemetryGatewayConfig,
  fetchImplementation: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
) {
  const logger = new StructuredLogger("telemetry-test", { emitToConsole: false });
  return {
    gateway: new TelemetryGateway(config, logger, fetchImplementation as typeof fetch),
    logger,
  };
}

function createRequest(options: {
  method?: string;
  path?: string;
  query?: URLSearchParams;
  contentType?: string | null;
  contentEncoding?: string;
  sentryAuth?: string;
  body?: Buffer;
  bodyStream?: AsyncIterable<Uint8Array>;
  discardBody?: () => void;
  ipAddress?: string;
  requestId?: string;
} = {}): TelemetryGatewayRequest {
  return {
    method: options.method ?? "POST",
    path: options.path ?? "/telemetry/ga4",
    query: options.query ?? new URLSearchParams(),
    headers: {
      "content-type": options.contentType === null
        ? undefined
        : options.contentType ?? "application/json",
      "content-encoding": options.contentEncoding,
      "x-sentry-auth": options.sentryAuth,
    },
    body: options.bodyStream ?? bodyStream(options.body ?? Buffer.from("{}")),
    discardBody: options.discardBody,
    ipAddress: options.ipAddress ?? "127.0.0.1",
    requestId: options.requestId ?? "req_test",
  };
}

async function* bodyStream(body: Buffer): AsyncIterable<Uint8Array> {
  yield body;
}

async function* neverEndingBody(): AsyncIterable<Uint8Array> {
  await new Promise<void>(() => undefined);
}
