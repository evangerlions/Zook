import assert from "node:assert/strict";
import test from "node:test";
import { BailianOpenAICompatibleProvider } from "../../src/services/bailian-openai-compatible-provider.ts";
import {
  createDefaultOpenRouterConfig,
  normalizeOpenRouterConfig,
} from "../../src/services/openrouter-config.ts";
import {
  createOpenRouterProxySignature,
  createOpenRouterTransparentProxyFetch,
  OPENROUTER_PROXY_HEADERS,
} from "../../src/services/openrouter-transparent-proxy.ts";
import type { LLMStreamEvent } from "../../src/services/llm-manager.ts";
import type { OpenRouterConfig } from "../../src/shared/types.ts";

const TEST_SECRET = Buffer.from(
  Array.from({ length: 32 }, (_, index) => index),
).toString("base64url");

function createEnabledConfig(): OpenRouterConfig {
  return {
    useTransparentProxy: true,
    transparentProxyBaseUrl: "https://oa.zimozone.com",
    transparentProxyKeyId: "server-a",
    transparentProxyHmacSecretKey: "openrouter.proxy.hmac_secret",
  };
}

test("OpenRouter signature matches the deployed oa-hmac-v1 vector", () => {
  assert.equal(
    createOpenRouterProxySignature({
      keyId: "server-a",
      encodedSecret: TEST_SECRET,
      method: "POST",
      requestTarget: "/api/v1/chat/completions?x=1",
      timestamp: "1785856001",
      nonce: "AAAAAAAAAAAAAAAAAAAAAA",
      authorization: "Bearer sk-or-test",
    }),
    "Ndo8y4SxZxOtx74kS88zz4cRlvstoZ_vPROlcPw5H80",
  );
});

test("OpenRouter config remains backward compatible and validates enabled proxy settings", () => {
  assert.deepEqual(normalizeOpenRouterConfig(undefined), createDefaultOpenRouterConfig());
  assert.throws(
    () => normalizeOpenRouterConfig({ useTransparentProxy: true }),
    /key id is required/i,
  );
  assert.throws(
    () => normalizeOpenRouterConfig({
      useTransparentProxy: true,
      transparentProxyKeyId: "server-a",
      transparentProxyBaseUrl: "http://oa.zimozone.com",
    }),
    /must be an HTTPS URL/i,
  );
});

test("OpenRouter fetch stays direct when the switch is off or HMAC Secret is empty", async (context) => {
  for (const scenario of [
    { name: "switch off", config: createDefaultOpenRouterConfig(), secret: TEST_SECRET },
    { name: "secret empty", config: createEnabledConfig(), secret: undefined },
  ]) {
    await context.test(scenario.name, async () => {
      const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
      const proxyFetch = createOpenRouterTransparentProxyFetch({
        resolveConfig: async () => scenario.config,
        resolveSecret: async () => scenario.secret,
        fetchImplementation: async (input, init) => {
          calls.push({ input, init });
          return new Response("ok");
        },
      });
      const url = "https://openrouter.ai/api/v1/models";

      await proxyFetch(url, {
        headers: { Authorization: "Bearer token2" },
      });

      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.input, url);
      assert.equal(
        new Headers(calls[0]?.init?.headers).has(OPENROUTER_PROXY_HEADERS.signature),
        false,
      );
    });
  }
});

test("OpenRouter fetch rewrites and signs any method while preserving TOKEN2 and request data", async () => {
  let capturedInput: RequestInfo | URL | undefined;
  let capturedInit: RequestInit | undefined;
  const proxyFetch = createOpenRouterTransparentProxyFetch({
    resolveConfig: async () => createEnabledConfig(),
    resolveSecret: async (key) => key === "openrouter.proxy.hmac_secret" ? TEST_SECRET : undefined,
    nowSeconds: () => 1785856001,
    createNonce: () => "AAAAAAAAAAAAAAAAAAAAAA",
    fetchImplementation: async (input, init) => {
      capturedInput = input;
      capturedInit = init;
      return new Response("ok");
    },
  });

  await proxyFetch("https://openrouter.ai/api/v1/keys/key-1?dry_run=true", {
    method: "DELETE",
    headers: {
      Authorization: "Bearer token2",
      "X-Caller-Header": "preserved",
    },
    body: JSON.stringify({ reason: "test" }),
  });

  assert.equal(String(capturedInput), "https://oa.zimozone.com/api/v1/keys/key-1?dry_run=true");
  assert.equal(capturedInit?.method, "DELETE");
  assert.equal(capturedInit?.body, JSON.stringify({ reason: "test" }));
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get("authorization"), "Bearer token2");
  assert.equal(headers.get("x-caller-header"), "preserved");
  assert.equal(headers.get(OPENROUTER_PROXY_HEADERS.keyId), "server-a");
  assert.equal(headers.get(OPENROUTER_PROXY_HEADERS.timestamp), "1785856001");
  assert.equal(headers.get(OPENROUTER_PROXY_HEADERS.nonce), "AAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(
    headers.get(OPENROUTER_PROXY_HEADERS.signature),
    createOpenRouterProxySignature({
      keyId: "server-a",
      encodedSecret: TEST_SECRET,
      method: "DELETE",
      requestTarget: "/api/v1/keys/key-1?dry_run=true",
      timestamp: "1785856001",
      nonce: "AAAAAAAAAAAAAAAAAAAAAA",
      authorization: "Bearer token2",
    }),
  );
});

test("OpenRouter proxy credentials are resolved for each request without restart", async () => {
  let secret: string | undefined;
  const calls: string[] = [];
  const proxyFetch = createOpenRouterTransparentProxyFetch({
    resolveConfig: async () => createEnabledConfig(),
    resolveSecret: async () => secret,
    fetchImplementation: async (input) => {
      calls.push(String(input));
      return new Response("ok");
    },
  });

  await proxyFetch("https://openrouter.ai/api/v1/models");
  secret = TEST_SECRET;
  await proxyFetch("https://openrouter.ai/api/v1/models");

  assert.deepEqual(calls, [
    "https://openrouter.ai/api/v1/models",
    "https://oa.zimozone.com/api/v1/models",
  ]);
});

test("OpenRouter proxy rejects a malformed non-empty Secret instead of leaking to direct upstream", async () => {
  let requestCount = 0;
  const proxyFetch = createOpenRouterTransparentProxyFetch({
    resolveConfig: async () => createEnabledConfig(),
    resolveSecret: async () => "not-a-valid-secret",
    fetchImplementation: async () => {
      requestCount += 1;
      return new Response("unexpected");
    },
  });

  await assert.rejects(
    proxyFetch("https://openrouter.ai/api/v1/models"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "LLM_SERVICE_NOT_CONFIGURED",
  );
  assert.equal(requestCount, 0);
});

test("OpenRouter proxy leaves other OpenAI-compatible providers untouched", async () => {
  let capturedUrl = "";
  const proxyFetch = createOpenRouterTransparentProxyFetch({
    resolveConfig: async () => createEnabledConfig(),
    resolveSecret: async () => TEST_SECRET,
    fetchImplementation: async (input) => {
      capturedUrl = String(input);
      return new Response("ok");
    },
  });

  await proxyFetch("https://dashscope.aliyuncs.com/compatible-mode/v1/models");
  assert.equal(capturedUrl, "https://dashscope.aliyuncs.com/compatible-mode/v1/models");
});

test("OpenRouter SSE remains streamable through the transparent proxy fetch", async () => {
  let capturedUrl = "";
  const encoder = new TextEncoder();
  const proxyFetch = createOpenRouterTransparentProxyFetch({
    resolveConfig: async () => createEnabledConfig(),
    resolveSecret: async () => TEST_SECRET,
    fetchImplementation: async (input) => {
      capturedUrl = String(input);
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(
              'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":"stop"}]}\n\n',
            ));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  const provider = new BailianOpenAICompatibleProvider({ fetchImplementation: proxyFetch });
  const events: LLMStreamEvent[] = [];

  for await (const event of provider.stream({
    model: {
      provider: "openrouter",
      modelKey: "openai/gpt-5-mini",
      resolvedModelKey: "openai/gpt-5-mini",
      providerModel: "openai/gpt-5-mini",
      providerConfig: {
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "token2",
        timeoutMs: 30_000,
      },
    },
    messages: [{ role: "user", content: "hello" }],
  })) {
    events.push(event);
  }

  assert.equal(capturedUrl, "https://oa.zimozone.com/api/v1/chat/completions");
  assert.deepEqual(events.map((event) => event.type), ["content_delta", "done"]);
});
