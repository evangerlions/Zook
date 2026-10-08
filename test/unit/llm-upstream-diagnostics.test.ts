import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryKVBackend, KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
import { StructuredLogger } from "../../src/infrastructure/logging/pino-logger.module.ts";
import { probeDirectTls } from "../../src/services/llm-upstream-direct-probe.ts";
import { LlmUpstreamDiagnosticsService } from "../../src/services/llm-upstream-diagnostics.service.ts";
import type { LlmUpstreamFailureDiagnostic } from "../../src/services/llm-upstream-diagnostics-types.ts";

const diagnostic: LlmUpstreamFailureDiagnostic = {
  diagnosticId: "9a1f0c10-88d2-4a1c-b5db-6d7963487bdf",
  provider: "bai",
  modelKey: "model-a",
  providerModel: "vendor-model-a",
  requestedHost: "api.b.ai",
  lastCompletedStage: "request_started",
  bodyBytes: 0,
  sseEventCount: 0,
  elapsedMs: 30_000,
  errorCode: "LLM_PROVIDER_REQUEST_FAILED",
  errorReason: "timeout",
};

test("proxy failure triggers an unauthenticated prefixed health probe at most once per cooldown", async () => {
  const backend = new InMemoryKVBackend();
  const kvManager = await KVManager.create({ backend });
  const logger = new StructuredLogger("api", { emitToConsole: false });
  const fetchCalls: Array<{ url: string; method?: string; headers?: Headers }> = [];
  const service = new LlmUpstreamDiagnosticsService(
    {
      getCurrentConfig: async () => ({
        bai: {
          useTransparentProxy: true,
          transparentProxyBaseUrl: "https://oa.example.test/bai",
          transparentProxyKeyId: "server-bai",
          transparentProxyHmacSecretKey: "bai.proxy.secret",
        },
      }),
    } as never,
    { getValue: async () => "test-secret-never-logged" } as never,
    kvManager,
    logger,
    {
      fetchImplementation: async (input, init) => {
        fetchCalls.push({
          url: String(input),
          method: init?.method,
          headers: new Headers(init?.headers),
        });
        return new Response('{"status":"ok"}', { status: 200 });
      },
      probeDirectHost: async () => ({ outcome: "unexpected", elapsedMs: 0 }),
    },
  );

  await service.reportFailure(diagnostic);
  await service.reportFailure({
    ...diagnostic,
    diagnosticId: "b11f2d0e-89db-4b3f-ae3a-72580cd9eec4",
  });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]?.url, "https://oa.example.test/bai/_proxy/health");
  assert.equal(fetchCalls[0]?.method, "GET");
  assert.equal(fetchCalls[0]?.headers?.has("authorization"), false);
  assert.equal(
    logger.records.filter((record) => record.message === "LLM upstream connectivity probe completed").length,
    1,
  );
  assert.equal(
    logger.records.filter((record) => record.message === "LLM upstream request failed").length,
    2,
  );
  assert.equal(
    logger.records.filter((record) => record.message === "LLM upstream connectivity probe throttled").length,
    0,
  );
  assert.equal(JSON.stringify(logger.records).includes("test-secret-never-logged"), false);
  await kvManager.disconnect();
});

test("direct connectivity probe is limited per target host and does not run for HTTP errors", async () => {
  const backend = new InMemoryKVBackend();
  const kvManager = await KVManager.create({ backend });
  const logger = new StructuredLogger("api", { emitToConsole: false });
  const probedHosts: string[] = [];
  const service = new LlmUpstreamDiagnosticsService(
    {
      getCurrentConfig: async () => ({
        openRouter: {
          useTransparentProxy: false,
          transparentProxyBaseUrl: "https://oa.example.test",
          transparentProxyKeyId: "",
          transparentProxyHmacSecretKey: "openrouter.proxy.secret",
        },
      }),
    } as never,
    { getValue: async () => undefined } as never,
    kvManager,
    logger,
    {
      probeDirectHost: async (hostname) => {
        probedHosts.push(hostname);
        return { outcome: "tls_connected", elapsedMs: 5 };
      },
    },
  );

  await service.reportFailure({
    ...diagnostic,
    provider: "openrouter",
    requestedHost: "openrouter.ai",
  });
  await service.reportFailure({
    ...diagnostic,
    diagnosticId: "b11f2d0e-89db-4b3f-ae3a-72580cd9eec4",
    provider: "openrouter",
    requestedHost: "openrouter.ai",
  });
  await service.reportFailure({
    ...diagnostic,
    diagnosticId: "4fc19869-fc32-4823-a646-a92f281bed36",
    provider: "openrouter",
    requestedHost: "openrouter.ai",
    responseStatus: 401,
    errorReason: "provider_error",
  });

  assert.deepEqual(probedHosts, ["openrouter.ai"]);
  assert.equal(
    logger.records.filter((record) => record.message === "LLM upstream request failed").length,
    2,
  );
  await kvManager.disconnect();
});

test("a shared cooldown suppresses repeated Redis claims in the same process", async () => {
  let claimCalls = 0;
  let probeCalls = 0;
  const logger = new StructuredLogger("api", { emitToConsole: false });
  const service = new LlmUpstreamDiagnosticsService(
    {} as never,
    {} as never,
    {
      setStringIfAbsent: async () => {
        claimCalls += 1;
        return false;
      },
    } as never,
    logger,
    {
      probeDirectHost: async () => {
        probeCalls += 1;
        return { outcome: "unexpected", elapsedMs: 0 };
      },
    },
  );

  await service.reportFailure({ ...diagnostic, provider: "bailian", requestedHost: "dashscope.aliyuncs.com" });
  await service.reportFailure({
    ...diagnostic,
    diagnosticId: "b11f2d0e-89db-4b3f-ae3a-72580cd9eec4",
    provider: "bailian",
    requestedHost: "dashscope.aliyuncs.com",
  });

  assert.equal(claimCalls, 1);
  assert.equal(probeCalls, 0);
});

test("HTTP 2xx stream failures remain visible to diagnostics", async () => {
  const logger = new StructuredLogger("api", { emitToConsole: false });
  let probeCalls = 0;
  const service = new LlmUpstreamDiagnosticsService(
    {} as never,
    {} as never,
    {
      setStringIfAbsent: async () => true,
    } as never,
    logger,
    {
      probeDirectHost: async () => {
        probeCalls += 1;
        return { outcome: "tls_connected", elapsedMs: 2 };
      },
    },
  );

  await service.reportFailure({
    ...diagnostic,
    provider: "bailian",
    requestedHost: "dashscope.aliyuncs.com",
    responseStatus: 200,
    lastCompletedStage: "response_headers",
    errorCode: "LLM_PROVIDER_RESPONSE_INVALID",
    errorReason: "invalid_sse",
  });

  assert.equal(probeCalls, 0);
  assert.equal(
    logger.records.filter((record) => record.message === "LLM upstream request failed").length,
    1,
  );
});

test("HTTP 2xx timeout failures still run the bounded connectivity probe", async () => {
  const logger = new StructuredLogger("api", { emitToConsole: false });
  let probeCalls = 0;
  const service = new LlmUpstreamDiagnosticsService(
    {} as never,
    {} as never,
    { setStringIfAbsent: async () => true } as never,
    logger,
    {
      probeDirectHost: async () => {
        probeCalls += 1;
        return { outcome: "tls_connected", elapsedMs: 2 };
      },
    },
  );

  await service.reportFailure({
    ...diagnostic,
    provider: "bailian",
    requestedHost: "dashscope.aliyuncs.com",
    responseStatus: 200,
    errorCode: "TimeoutError",
  });

  assert.equal(probeCalls, 1);
});

test("manual proxy health redirects are reported without following them", async () => {
  const logger = new StructuredLogger("api", { emitToConsole: false });
  const fetchRequests: Array<{ url: string; redirect?: RequestRedirect }> = [];
  const service = new LlmUpstreamDiagnosticsService(
    {
      getCurrentConfig: async () => ({
        bai: {
          useTransparentProxy: true,
          transparentProxyBaseUrl: "https://oa.example.test/bai",
          transparentProxyKeyId: "server-bai",
          transparentProxyHmacSecretKey: "bai.proxy.secret",
        },
      }),
    } as never,
    { getValue: async () => "test-secret-never-logged" } as never,
    {
      setStringIfAbsent: async () => true,
    } as never,
    logger,
    {
      fetchImplementation: async (input, init) => {
        fetchRequests.push({ url: String(input), redirect: init?.redirect });
        return new Response(null, {
          status: 302,
          headers: { location: "https://unexpected.example/health" },
        });
      },
      probeDirectHost: async () => ({ outcome: "unexpected", elapsedMs: 0 }),
    },
  );

  await service.reportFailure(diagnostic);

  assert.deepEqual(fetchRequests, [{
    url: "https://oa.example.test/bai/_proxy/health",
    redirect: "manual",
  }]);
  const probe = logger.records.find((record) =>
    record.message === "LLM upstream connectivity probe completed"
  );
  assert.equal(probe?.outcome, "http_redirect");
  assert.equal(probe?.statusCode, 302);
});

test("skips connectivity probes when shared cooldown storage is unavailable", async () => {
  const logger = new StructuredLogger("api", { emitToConsole: false });
  let probeCalls = 0;
  const service = new LlmUpstreamDiagnosticsService(
    {} as never,
    {} as never,
    {
      setStringIfAbsent: async () => {
        throw new Error("shared kv unavailable");
      },
    } as never,
    logger,
    {
      probeDirectHost: async () => {
        probeCalls += 1;
        return { outcome: "tls_connected", elapsedMs: 2 };
      },
    },
  );

  await service.reportFailure({
    ...diagnostic,
    provider: "bailian",
    requestedHost: "dashscope.aliyuncs.com",
  });
  await service.reportFailure({
    ...diagnostic,
    diagnosticId: "b11f2d0e-89db-4b3f-ae3a-72580cd9eec4",
    provider: "bailian",
    requestedHost: "dashscope.aliyuncs.com",
  });

  assert.equal(probeCalls, 0);
  const skips = logger.records.filter((record) =>
    record.message === "LLM upstream connectivity probe skipped"
  );
  assert.equal(skips.length, 1);
  assert.equal(skips[0]?.reason, "shared_throttle_unavailable");
  assert.equal(skips[0]?.throttleMode, "fail_closed");
});

test("direct TLS probe tries the next resolved address after a failed address", async () => {
  const attemptedAddresses: string[] = [];
  let now = 1_000;
  const result = await probeDirectTls("dashscope.example.test", 100, {
    now: () => now,
    lookupHost: async () => [
      { address: "192.0.2.10", family: 4 },
      { address: "2001:db8::10", family: 6 },
    ],
    connectTlsAddress: async (address) => {
      attemptedAddresses.push(address.address);
      now += 5;
      return address.family === 4
        ? { outcome: "tcp_error", errorCode: "ECONNREFUSED", elapsedMs: 5 }
        : {
            outcome: "tls_connected",
            tcpConnectMs: 2,
            tlsHandshakeMs: 3,
            elapsedMs: 5,
          };
    },
  });

  assert.deepEqual(attemptedAddresses, ["192.0.2.10", "2001:db8::10"]);
  assert.equal(result.outcome, "tls_connected");
  assert.equal(result.resolvedAddressCount, 2);
  assert.equal(result.attemptedAddressCount, 2);
});
