import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultBaiConfig, normalizeBaiConfig } from "../../src/services/bai-transparent-proxy-config.ts";
import { createBaiTransparentProxyFetch } from "../../src/services/bai-transparent-proxy.ts";
import { OPENROUTER_PROXY_HEADERS } from "../../src/services/openrouter-transparent-proxy.ts";

const secret = Buffer.alloc(32, 7).toString("base64url");

test("B.AI proxy config stays disabled until a proxy base URL and key id are supplied", () => {
  assert.deepEqual(normalizeBaiConfig(undefined), createDefaultBaiConfig());
  assert.throws(
    () => normalizeBaiConfig({ useTransparentProxy: true }),
    /base URL is required/i,
  );
});

test("B.AI transparent proxy preserves Authorization while signing the proxy request", async () => {
  let capturedInput: RequestInfo | URL | undefined;
  let capturedInit: RequestInit | undefined;
  const proxyFetch = createBaiTransparentProxyFetch({
    resolveConfig: async () => ({
      useTransparentProxy: true,
      transparentProxyBaseUrl: "https://bai-proxy.example.com",
      transparentProxyKeyId: "server-bai",
      transparentProxyHmacSecretKey: "bai.proxy.hmac_secret",
    }),
    resolveSecret: async () => secret,
    nowSeconds: () => 1785856001,
    createNonce: () => "AAAAAAAAAAAAAAAAAAAAAA",
    fetchImplementation: async (input, init) => {
      capturedInput = input;
      capturedInit = init;
      return new Response("ok");
    },
  });

  await proxyFetch("https://api.b.ai/v1/chat/completions?stream=true", {
    method: "POST",
    headers: { Authorization: "Bearer caller-owned-bai-key" },
    body: "{}",
  });

  assert.equal(String(capturedInput), "https://bai-proxy.example.com/v1/chat/completions?stream=true");
  assert.equal(capturedInit?.body, "{}");
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get("authorization"), "Bearer caller-owned-bai-key");
  assert.equal(headers.get(OPENROUTER_PROXY_HEADERS.keyId), "server-bai");
  assert.ok(headers.get(OPENROUTER_PROXY_HEADERS.signature));
});
