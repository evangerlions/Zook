import assert from "node:assert/strict";
import test from "node:test";
import { BailianOpenAICompatibleProvider } from "../../src/services/bailian-openai-compatible-provider.ts";
import { EmbeddingManager } from "../../src/services/embedding-manager.ts";
import { LlmCallerCancelledError } from "../../src/services/llm-caller-cancellation.ts";

test("embedding cancellation propagates through manager and provider to upstream fetch", async () => {
  let upstream: AbortSignal | undefined;
  const provider = new BailianOpenAICompatibleProvider({ apiKey: "test", fetchImplementation: async (_url, init) => {
    upstream = init?.signal as AbortSignal;
    return new Promise<Response>((_resolve, reject) => {
      upstream!.addEventListener("abort", () => reject(upstream!.reason), { once: true });
    });
  } });
  const manager = new EmbeddingManager({ bailian: provider }, { m: { provider: "bailian", providerModel: "test" } });
  const controller = new AbortController();
  const pending = manager.embed({ modelKey: "m", input: ["text"], signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(new Error("cancelled"));
  await assert.rejects(pending, LlmCallerCancelledError);
  assert.equal(upstream?.aborted, true);
});

test("pre-aborted embedding never contacts upstream", async () => {
  let calls = 0;
  const provider = new BailianOpenAICompatibleProvider({ apiKey: "test", fetchImplementation: async () => { calls++; throw Error("unexpected"); } });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(provider.embed({ signal: controller.signal, input: ["text"], model: {
    provider: "bailian", modelKey: "m", resolvedModelKey: "m", providerModel: "test",
  } }), LlmCallerCancelledError);
  assert.equal(calls, 0);
});
