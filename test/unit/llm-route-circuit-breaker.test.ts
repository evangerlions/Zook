import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryKVBackend, KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
import { LlmRouteCircuitBreakerService } from "../../src/services/llm-route-circuit-breaker.service.ts";
import { LlmRouteCircuitRecoveryService } from "../../src/services/llm-route-circuit-recovery.service.ts";
import { LLMManager, type LLMProvider, type LLMStreamEvent } from "../../src/services/llm-manager.ts";

const route = {
  modelKey: "model-a",
  provider: "provider-a",
  providerModel: "upstream-a",
  operation: "chat" as const,
};

test("route circuit requires four pre-chunk failures from at least two users and success clears the window", async () => {
  let now = new Date("2030-01-01T00:00:00.000Z");
  const circuit = new LlmRouteCircuitBreakerService(
    await KVManager.create({ backend: new InMemoryKVBackend() }),
    { now: () => now },
  );

  for (const userId of ["user-a", "user-b", "user-a"]) {
    await circuit.recordPreFirstChunkFailure(route, userId, true);
  }
  assert.equal((await circuit.getRuntimeStatus(route, true)).state, "closed");

  await circuit.recordFirstEffectiveChunk(route, true);
  assert.equal((await circuit.getRuntimeStatus(route, true)).failureCount, 0);

  for (const userId of ["user-a", "user-a", "user-a", "user-a"]) {
    await circuit.recordPreFirstChunkFailure(route, userId, true);
  }
  assert.equal((await circuit.getRuntimeStatus(route, true)).state, "closed");

  await circuit.recordFirstEffectiveChunk(route, true);
  for (const userId of ["user-a", "user-b", "user-a", "user-b"]) {
    await circuit.recordPreFirstChunkFailure(route, userId, true);
  }
  const confirming = await circuit.getRuntimeStatus(route, true);
  assert.equal(confirming.state, "confirming");
  assert.equal(confirming.failureCount, 4);
  assert.equal(confirming.distinctUserCount, 2);
  assert.equal(await circuit.isOpen(route, true), false);
  const confirmation = await circuit.claimCircuitConfirmation(route);
  assert.ok(confirmation);
  assert.equal(await circuit.completeCircuitConfirmation(confirmation, false), "opened");
  assert.equal(await circuit.isOpen(route, true), true);

  now = new Date("2030-01-01T00:05:00.000Z");
  let probes = 0;
  const recovery = await circuit.recoverDueRoutes(true, async () => {
    probes += 1;
    return true;
  });
  assert.deepEqual(recovery, { attempted: 1, restored: 1, failed: 0 });
  assert.equal(probes, 2);
  assert.equal((await circuit.getRuntimeStatus(route, true)).state, "closed");
});

test("route circuit uses 10 minute recovery delay after the first failed probe and clears when disabled", async () => {
  let now = new Date("2030-01-01T00:00:00.000Z");
  const circuit = new LlmRouteCircuitBreakerService(
    await KVManager.create({ backend: new InMemoryKVBackend() }),
    { now: () => now },
  );
  for (const userId of ["user-a", "user-b", "user-a", "user-b"]) {
    await circuit.recordPreFirstChunkFailure(route, userId, true);
  }
  const confirmation = await circuit.claimCircuitConfirmation(route);
  assert.ok(confirmation);
  assert.equal(await circuit.completeCircuitConfirmation(confirmation, false), "opened");
  now = new Date("2030-01-01T00:05:00.000Z");
  assert.deepEqual(await circuit.recoverDueRoutes(true, async () => false), {
    attempted: 1,
    restored: 0,
    failed: 1,
  });
  assert.equal(
    (await circuit.getRuntimeStatus(route, true)).nextRecoveryAt,
    "2030-01-01T00:15:00.000Z",
  );
  assert.deepEqual(await circuit.recoverDueRoutes(false, async () => true), {
    attempted: 0,
    restored: 0,
    failed: 0,
  });
  assert.equal((await circuit.getRuntimeStatus(route, true)).state, "closed");
});

test("LLM manager only counts failures before a non-empty stream chunk", async () => {
  const circuit = new LlmRouteCircuitBreakerService(
    await KVManager.create({ backend: new InMemoryKVBackend() }),
  );
  let mode: "empty" | "partial_tool" | "fail" | "success" = "empty";
  let streamCalls = 0;
  let confirmationRequests = 0;
  const provider: LLMProvider = {
    async complete() {
      throw new Error("unused");
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      streamCalls += 1;
      if (mode === "empty") yield { type: "content_delta", text: "" };
      if (mode === "partial_tool") yield { type: "tool_call_delta", text: "{\"draft\":" };
      if (mode === "success") {
        yield { type: "content_delta", text: "OK" };
        yield { type: "done" };
        return;
      }
      throw new Error("upstream unavailable");
    },
  };
  const config = {
    enabled: true,
    defaultModelKey: "model-a",
    openRouter: { useTransparentProxy: false, transparentProxyBaseUrl: "", transparentProxyKeyId: "", transparentProxyHmacSecretKey: "" },
    bai: { useTransparentProxy: false, transparentProxyBaseUrl: "", transparentProxyKeyId: "", transparentProxyHmacSecretKey: "" },
    routeCircuitBreaker: { enabled: true },
    providers: [{ key: "provider-a", label: "Provider A", enabled: true, baseUrl: "https://example.test/v1", apiKey: "test", timeoutMs: 1_000 }],
    models: [{ key: "model-a", label: "Model A", kind: "chat" as const, strategy: "fixed" as const, routes: [{ provider: "provider-a", providerModel: "upstream-a", enabled: true, weight: 100 }]}],
  };
  const manager = new LLMManager(
    { "provider-a": provider },
    {},
    {
      llmRouteCircuitBreaker: circuit,
      onLlmRouteCircuitConfirmation: () => {
        confirmationRequests += 1;
      },
      commonLlmConfigService: {
        async getRuntimeConfigSnapshot() {
          return { config, revision: 1, updatedAt: "2030-01-01T00:00:00.000Z" };
        },
      } as never,
    },
  );
  const call = async (userId: string) => {
    try {
      for await (const _event of manager.stream({
        modelKey: "model-a",
        messages: [{ role: "user", content: "hello" }],
        usageOwner: { appId: "app", userId },
      })) {
        // Consume all events so stream finalization has completed.
      }
    } catch {
      // The test deliberately uses an upstream failure.
    }
  };

  await call("user-a");
  assert.equal((await circuit.getRuntimeStatus(route, true)).failureCount, 1);

  mode = "partial_tool";
  await call("user-b");
  assert.equal((await circuit.getRuntimeStatus(route, true)).failureCount, 2);

  mode = "success";
  await call("user-a");
  assert.equal((await circuit.getRuntimeStatus(route, true)).failureCount, 0);

  mode = "fail";
  await call("user-a");
  await call("user-b");
  await call("user-a");
  await call("user-b");
  assert.equal((await circuit.getRuntimeStatus(route, true)).state, "confirming");
  assert.equal(confirmationRequests, 1);
  const callsBeforeConfirmation = streamCalls;
  await call("user-c");
  assert.equal(streamCalls, callsBeforeConfirmation + 1);
  assert.equal(confirmationRequests, 1);
  const confirmation = await circuit.claimCircuitConfirmation(route);
  assert.ok(confirmation);
  assert.equal(await circuit.completeCircuitConfirmation(confirmation, false), "opened");
  await assert.rejects(
    async () => {
      for await (const _event of manager.stream({
        modelKey: "model-a",
        messages: [{ role: "user", content: "hello" }],
        usageOwner: { appId: "app", userId: "user-c" },
      })) {
        // no-op
      }
    },
    (error: unknown) => error instanceof Error && "code" in error && error.code === "LLM_ROUTE_NOT_AVAILABLE",
  );
});

test("concurrent pre-chunk failures serialize instead of dropping an outage burst", async () => {
  const circuit = new LlmRouteCircuitBreakerService(
    await KVManager.create({ backend: new InMemoryKVBackend() }),
  );
  await Promise.all(["user-a", "user-b", "user-a", "user-b"].map((userId) =>
    circuit.recordPreFirstChunkFailure(route, userId, true),
  ));
  assert.equal((await circuit.getRuntimeStatus(route, true)).state, "confirming");
});

test("a successful confirmation probe clears the threshold without opening the route", async () => {
  const circuit = new LlmRouteCircuitBreakerService(
    await KVManager.create({ backend: new InMemoryKVBackend() }),
  );
  for (const userId of ["user-a", "user-b", "user-a", "user-b"]) {
    await circuit.recordPreFirstChunkFailure(route, userId, true);
  }
  const confirmation = await circuit.claimCircuitConfirmation(route);
  assert.ok(confirmation);
  assert.equal(await circuit.completeCircuitConfirmation(confirmation, true), "cleared");
  assert.equal((await circuit.getRuntimeStatus(route, true)).state, "closed");
});

test("confirmation retries only its route with the existing smoke request before opening", async () => {
  const circuit = new LlmRouteCircuitBreakerService(
    await KVManager.create({ backend: new InMemoryKVBackend() }),
  );
  for (const userId of ["user-a", "user-b", "user-a", "user-b"]) {
    await circuit.recordPreFirstChunkFailure(route, userId, true);
  }
  let attempts = 0;
  const recovery = new LlmRouteCircuitRecoveryService(
    {
      async getRuntimeConfig() {
        return {
          enabled: true,
          routeCircuitBreaker: { enabled: true },
          providers: [{ key: "provider-a", label: "Provider A", enabled: true, baseUrl: "https://example.test/v1", apiKey: "test", timeoutMs: 1_000 }],
          models: [{ key: "model-a", label: "Model A", kind: "chat" as const, strategy: "fixed" as const, routes: [{ provider: "provider-a", providerModel: "upstream-a", enabled: true, weight: 100 }]}],
        };
      },
    } as never,
    circuit,
    {
      "provider-a": {
        async complete(request) {
          attempts += 1;
          assert.equal(request.model.providerModel, "upstream-a");
          assert.equal(request.maxTokens, 64);
          if (attempts === 1) throw new Error("first probe failed");
          return { provider: "provider-a", modelKey: "model-a", providerModel: "upstream-a", text: "OK" };
        },
        async *stream(): AsyncIterable<LLMStreamEvent> {
          throw new Error("unused");
        },
      },
    },
  );

  await recovery.confirmRoute(route);
  assert.equal(attempts, 2);
  assert.equal((await circuit.getRuntimeStatus(route, true)).state, "closed");
});
