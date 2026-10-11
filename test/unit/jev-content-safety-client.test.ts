import assert from "node:assert/strict";
import test from "node:test";
import { JevContentSafetyClient, buildJevModerationBody } from "../../src/services/jev-content-safety-client.ts";
import { LlmContentSafetyChecker } from "../../src/services/content-safety-llm-checker.ts";
import { ApplicationError } from "../../src/shared/errors.ts";
import { createOpenRouterTransparentProxyFetch } from "../../src/services/openrouter-transparent-proxy.ts";
import type { CommonLlmConfigService } from "../../src/services/common-llm-config.service.ts";
import type { ContentSafetyConfig } from "../../src/shared/types.ts";

const runtimeConfig = { enabled: true, providers: [{ key: "openrouter", enabled: true,
  apiKey: "test-only-key", baseUrl: "https://openrouter.ai/api/v1/" }] };
const config = { getRuntimeConfig: async () => runtimeConfig } as unknown as CommonLlmConfigService;
const safetyConfig = { llm: { enabled: true, useJev: true, modelKey: "qwen3.6-flash", timeoutMs: 5000 } } as ContentSafetyConfig;
const response = (choice: string) => Response.json({
  model: "typesafe/jev-1.13-20260917", id: "decision-id",
  answers: { moderation: { type: "choice", choice, confidence: 0.99 } },
  usage: { input_tokens: 2000, output_tokens: 20 },
});
const unusedManager = { complete: async () => { throw new Error("Must not call chat completion"); } } as any;

test("Jev sends typed Decisions request, reusing the canonical Chinese policy and credentials", async () => {
  const client = new JevContentSafetyClient(config, (async (url, init) => {
    assert.equal(String(url), "https://openrouter.ai/api/alpha/decisions");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-only-key");
    const body = JSON.parse(init!.body as string);
    assert.equal(body.state, "普通小说");
    assert.equal(body.model, "typesafe/jev-1.13");
    assert.equal(Object.keys(body.questions.moderation.criteria).length, 11);
    assert.match(body.questions.moderation.instructions, /正常小说/);
    assert.ok(Object.values(body.questions.moderation.criteria).every(value => typeof value === "string"));
    return response("safe");
  }) as typeof fetch);
  const result = await client.complete("普通小说", 5000);
  assert.equal(result.toolCalls?.[0].input.decision, "pass");
  assert.equal(result.providerRequestId, "decision-id");
  assert.equal(result.usage.totalTokens, 2020);
  assert.equal(buildJevModerationBody("text").questions.moderation.type, "choice");
});

test("Jev Decisions endpoint uses existing HMAC transparent proxy when configured", async () => {
  let calls = 0;
  const proxy = createOpenRouterTransparentProxyFetch({
    resolveConfig: async () => ({ useTransparentProxy: true, transparentProxyBaseUrl: "https://proxy.example.test",
      transparentProxyKeyId: "test", transparentProxyHmacSecretKey: "test.secret" }),
    resolveSecret: async () => Buffer.alloc(32, 1).toString("base64url"),
    fetchImplementation: (async (url, init) => {
      calls++;
      assert.equal(String(url), "https://proxy.example.test/api/alpha/decisions");
      assert.ok(new Headers(init?.headers).has("x-proxy-signature"));
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-only-key");
      return response("safe");
    }) as typeof fetch,
  });
  await new JevContentSafetyClient(config, proxy).complete("text", 5000);
  assert.equal(calls, 1);
});

test("disabled OpenRouter is respected and does not fall back to environment credentials", async () => {
  let calls = 0;
  const disabled = { getRuntimeConfig: async () => ({ ...runtimeConfig, providers: [] }) } as any;
  const client = new JevContentSafetyClient(disabled, (async () => { calls++; return response("safe"); }) as typeof fetch);
  await assert.rejects(client.complete("text", 5000), { code: "LLM_SERVICE_NOT_CONFIGURED" });
  assert.equal(calls, 0);
});

test("Jev block is recorded once and retains the existing sensitive-input error", async () => {
  const records: string[] = [];
  const client = new JevContentSafetyClient(config, (async () => response("fraud_privacy_abuse")) as typeof fetch);
  const checker = new LlmContentSafetyChecker(unusedManager, {
    recordCheck: async (_command, _config, input) => { records.push(input.decision); },
    logDecision: () => {},
    throwSensitive: () => { throw new ApplicationError(422, "AI_INPUT_CONTENT_SENSITIVE", "blocked"); },
  }, client);
  await assert.rejects(checker.check({ appId: "test", text: "text" }, safetyConfig, "text"), { code: "AI_INPUT_CONTENT_SENSITIVE" });
  assert.deepEqual(records, ["block"]);
});

test("HTTP errors, invalid JSON and unknown categories fail open with one attempt", async () => {
  for (const makeResponse of [
    () => new Response("private input echoed", { status: 429 }),
    () => new Response("bad json"),
    () => response("unknown-category"),
  ]) {
    let calls = 0;
    const records: string[] = [];
    const client = new JevContentSafetyClient(config, (async () => { calls++; return makeResponse(); }) as typeof fetch);
    const checker = new LlmContentSafetyChecker(unusedManager, {
      recordCheck: async (_cmd, _cfg, input) => { records.push(input.decision); },
      logDecision: () => {}, throwSensitive: () => { throw new Error("unexpected block"); },
    }, client);
    const result = await checker.check({ appId: "test", text: "text" }, safetyConfig, "text");
    assert.equal(result.layer, "failed_open");
    assert.equal(result.allowed, true);
    assert.deepEqual(records, ["failed_open"]);
    assert.equal(calls, 1);
    assert.ok(!result.failureDetail?.includes("private input echoed"));
  }
});

test("turning off Jev preserves the original Qwen completion path", async () => {
  let calls = 0;
  const completion = await new JevContentSafetyClient(config, (async () => response("safe")) as typeof fetch).complete("text", 5000);
  const manager = { complete: async (input: any) => {
    calls++;
    assert.equal(input.modelKey, "qwen3.6-flash");
    assert.equal(input.callPurpose, "content_safety");
    assert.equal(input.providerOptions.enable_thinking, false);
    return completion;
  } } as any;
  const checker = new LlmContentSafetyChecker(manager, {
    recordCheck: async () => {}, logDecision: () => {},
    throwSensitive: () => { throw new Error("unexpected"); },
  });
  const result = await checker.check({ appId: "test", text: "text" },
    { ...safetyConfig, llm: { ...safetyConfig.llm, useJev: false } }, "text");
  assert.equal(result.allowed, true);
  assert.equal(calls, 1);
});

test("Jev timeout aborts upstream and never retries", async () => {
  let calls = 0;
  let aborted = false;
  const client = new JevContentSafetyClient(config, ((_, init) => {
    calls++;
    return new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => { aborted = true; reject(init!.signal!.reason); }, { once: true });
    });
  }) as typeof fetch);
  const checker = new LlmContentSafetyChecker(unusedManager, {
    recordCheck: async () => {}, logDecision: () => {},
    throwSensitive: () => { throw new Error("unexpected block"); },
  }, client);
  const result = await checker.check({ appId: "test", text: "text" },
    { ...safetyConfig, llm: { ...safetyConfig.llm, timeoutMs: 20 } }, "text");
  assert.equal(result.allowed, true);
  assert.equal(result.layer, "failed_open");
  assert.equal(aborted, true);
  assert.equal(calls, 1);
});
