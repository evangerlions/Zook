import { updateLlmRouteDraft } from "../../apps/admin-web/app/lib/llm-route-config.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOpenRouterRouteConfig } from "../../src/shared/openrouter-route-config.ts";
import { parseLlmConfigText, serializeLlmDraft } from "../../apps/admin-web/app/lib/llm-config.ts";
import { InMemoryCache } from "../../src/infrastructure/cache/redis/in-memory-cache.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { InMemoryKVBackend, KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
import { VersionedAppConfigService } from "../../src/services/versioned-app-config.service.ts";
import { CommonLlmConfigService } from "../../src/services/common-llm-config.service.ts";
import { LLMManager } from "../../src/services/llm-manager.ts";
import { OpenRouterOpenAICompatibleProvider } from "../../src/services/openrouter-openai-compatible-provider.ts";

const policy = { provider: { order: ["deepinfra", "gmicloud", "siliconflow"], allow_fallbacks: true } };
function config(openRouter: unknown = policy, provider = "openrouter") {
  return {
    enabled: true, defaultModelKey: "flash",
    providers: [{ key: provider, label: provider, enabled: true, baseUrl: "https://openrouter.ai/api/v1", apiKey: "test-key", timeoutMs: 30000 }],
    models: [{ key: "flash", label: "Flash", kind: "chat", strategy: "fixed", routes: [{ provider, providerModel: "deepseek/deepseek-v4-flash", enabled: true, weight: 100, openRouter }] }],
  };
}

test("OpenRouter route validation rejects misplaced, unknown and malformed settings", () => {
  assert.deepEqual(normalizeOpenRouterRouteConfig(policy, "openrouter"), policy);
  assert.equal(normalizeOpenRouterRouteConfig(undefined, "bailian"), undefined);
  assert.throws(() => normalizeOpenRouterRouteConfig(policy, "bailian"), /仅允许/);
  for (const value of [null, {}, { provider: null }, { provider: { bogus: true } }, { provider: { order: [""] } }, { provider: { order: ["deepinfra", "deepinfra"] } }, { provider: { allow_fallbacks: "true" } }, { provider: { sort: "random" } }, { provider: { max_price: { completion: -1 } } }]) {
    assert.throws(() => normalizeOpenRouterRouteConfig(value, "openrouter"));
  }
  assert.deepEqual(normalizeOpenRouterRouteConfig({ provider: {} }, "openrouter"), { provider: {} });
});

test("admin raw JSON and form roundtrip preserve route-specific policy", () => {
  const parsed = parseLlmConfigText(JSON.stringify(config()));
  assert.deepEqual(serializeLlmDraft(parsed.draft).models[0].routes[0].openRouter, policy);
  parsed.draft.models[0].routes[0].openRouterText = '{"provider":{"order":["gmicloud"],"allow_fallbacks":false}}';
  assert.deepEqual(serializeLlmDraft(parsed.draft).models[0].routes[0].openRouter?.provider.order, ["gmicloud"]);
  parsed.draft.models[0].routes[0].openRouterText = "";
  assert.equal(serializeLlmDraft(parsed.draft).models[0].routes[0].openRouter, undefined);
  assert.throws(() => parseLlmConfigText(JSON.stringify(config(policy, "bailian"))), /仅允许/);
});

test("canonical config update reaches the same manager and adapter on subsequent calls", async () => {
  const kv = await KVManager.create({ backend: new InMemoryKVBackend() });
  const store = new VersionedAppConfigService(new InMemoryDatabase(), new InMemoryCache(), kv);
  const service = new CommonLlmConfigService(store);
  const bodies: Record<string, unknown>[] = [];
  const provider = new OpenRouterOpenAICompatibleProvider({ fetchImplementation: async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content: "OK" }, finish_reason: "stop" }] }));
  } });
  const manager = new LLMManager({ openrouter: provider }, {}, { commonLlmConfigService: service });
  await service.updateConfig(config());
  await manager.complete({ modelKey: "flash", messages: [{ role: "user", content: "OK" }], providerOptions: { provider: { order: ["relace"] } } });
  assert.deepEqual(bodies[0].provider, policy.provider);
  await service.updateConfig(config({ provider: { order: ["gmicloud"], allow_fallbacks: false } }));
  await manager.complete({ modelKey: "flash", messages: [{ role: "user", content: "OK" }] });
  assert.deepEqual(bodies[1].provider, { order: ["gmicloud"], allow_fallbacks: false });
  const noPolicy = config();
  delete (noPolicy.models[0].routes[0] as { openRouter?: unknown }).openRouter;
  await service.updateConfig(noPolicy);
  await manager.complete({ modelKey: "flash", messages: [{ role: "user", content: "OK" }] });
  assert.equal(bodies[2].provider, undefined);
  await assert.rejects(() => service.updateConfig(config(policy, "bailian")), { code: "ADMIN_LLM_SERVICE_INVALID" });
});

test("switching route provider clears only the OpenRouter-specific draft", () => {
  const route = { provider: "openrouter", providerModel: "deepseek/deepseek-v4-flash", enabled: true, weight: "100", openRouterText: JSON.stringify(policy) };
  const changed = updateLlmRouteDraft(route, "provider", "bailian");
  assert.equal(changed.openRouterText, "");
  assert.equal(changed.provider, "bailian");
  assert.equal(changed.providerModel, route.providerModel);
  assert.equal(route.openRouterText, JSON.stringify(policy));
  assert.equal(updateLlmRouteDraft(route, "provider", "openrouter").openRouterText, route.openRouterText);
  assert.equal(updateLlmRouteDraft(route, "weight", "50").openRouterText, route.openRouterText);
});
