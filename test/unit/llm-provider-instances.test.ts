import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryCache } from "../../src/infrastructure/cache/redis/in-memory-cache.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { InMemoryKVBackend, KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
import { VersionedAppConfigService } from "../../src/services/versioned-app-config.service.ts";
import { CommonLlmConfigService } from "../../src/services/common-llm-config.service.ts";
import { CommonPasswordConfigService } from "../../src/services/common-password-config.service.ts";
import { PasswordManager } from "../../src/services/password-manager.ts";
import { SecretReferenceResolver } from "../../src/services/secret-reference-resolver.ts";
import { LLMManager, type ResolvedLLMCompletionRequest } from "../../src/services/llm-manager.ts";
import { evaluateLlmRoutes } from "../../src/services/llm-routing-score.ts";
import { createEmptyLlmProvider, createDefaultLlmConfig, serializeLlmDraft, cloneLlmConfig } from "../../apps/admin-web/app/lib/llm-config.ts";
import { OpenRouterOpenAICompatibleProvider } from "../../src/services/openrouter-openai-compatible-provider.ts";
import { LlmRouteCircuitBreakerService } from "../../src/services/llm-route-circuit-breaker.service.ts";

test("OpenRouter instances retain distinct keys and isolate a missing secret", async () => {
  const kv = await KVManager.create({ backend: new InMemoryKVBackend() });
  const store = new VersionedAppConfigService(new InMemoryDatabase(), new InMemoryCache(), kv);
  const passwords = new CommonPasswordConfigService(new PasswordManager(kv));
  const configs = new CommonLlmConfigService(store, new SecretReferenceResolver(passwords));
  await passwords.set("main", "test", "main-secret");
  await passwords.set("backup", "test", "backup-secret");
  const base = { label: "OpenRouter", enabled: true, baseUrl: "https://example.test/v1", timeoutMs: 30000 };
  await configs.updateConfig({ enabled: true, defaultModelKey: "flash", providers: [
    { ...base, key: "openrouter", apiKey: "{{zook.ps.main}}" },
    { ...base, key: "secondary", type: "openrouter", apiKey: "{{zook.ps.backup}}" },
  ], models: [{ key: "flash", label: "Flash", kind: "chat", strategy: "auto", routes: [
    { provider: "openrouter", providerModel: "vendor/flash", enabled: true, weight: 99 },
    { provider: "secondary", providerModel: "vendor/flash", enabled: true, weight: 1, openRouter: { provider: { only: ["vendor"] } } },
  ] }] });
  const calls: Array<[string, string | undefined]> = [];
  const adapter = { async complete(request: ResolvedLLMCompletionRequest) {
    calls.push([request.model.provider, request.model.providerConfig?.apiKey]);
    return { provider: request.model.provider, modelKey: request.model.modelKey, providerModel: request.model.providerModel, text: "ok" };
  }, async *stream(request: ResolvedLLMCompletionRequest) {
    calls.push([request.model.provider, request.model.providerConfig?.apiKey]);
    yield { type: "content_delta" as const, text: "ok" };
    yield { type: "done" as const };
  } };
  for (const random of [0, 0.999]) {
    const manager = new LLMManager({ openrouter: adapter }, undefined, { commonLlmConfigService: configs, random: () => random });
    await manager.complete({ modelKey: "flash", messages: [{ role: "user", content: "test" }] });
  }
  assert.deepEqual(calls, [["openrouter", "main-secret"], ["secondary", "backup-secret"]]);
  for (const random of [0, 0.999]) {
    const manager = new LLMManager({ openrouter: adapter }, undefined, { commonLlmConfigService: configs, random: () => random });
    for await (const _ of manager.stream({ modelKey: "flash", messages: [{ role: "user", content: "test" }] })) { /* consume */ }
  }
  assert.deepEqual(calls.slice(-2), [["openrouter", "main-secret"], ["secondary", "backup-secret"]]);
  const managers = [0, 0.999].map((random) => new LLMManager({ openrouter: adapter }, undefined, { commonLlmConfigService: configs, random: () => random }));
  await Promise.all(managers.map((manager) => manager.complete({ modelKey: "flash", messages: [{ role: "user", content: "parallel" }] })));
  assert.deepEqual(calls.slice(-2).sort(), [["openrouter", "main-secret"], ["secondary", "backup-secret"]].sort());
  await passwords.set("backup", "test", "");
  const config = await configs.getRuntimeConfig();
  assert.equal(config?.providers.find((p) => p.key === "openrouter")?.enabled, true);
  assert.equal(config?.providers.find((p) => p.key === "secondary")?.enabled, false);
  const fallback = new LLMManager({ openrouter: adapter }, undefined, { commonLlmConfigService: configs, random: () => 0.999 });
  await fallback.complete({ modelKey: "flash", messages: [{ role: "user", content: "test" }] });
  assert.deepEqual(calls.at(-1), ["openrouter", "main-secret"]);
  await passwords.set("backup", "test", "backup-secret");
  await passwords.set("main", "test", "");
  await fallback.complete({ modelKey: "flash", messages: [{ role: "user", content: "test" }] });
  assert.deepEqual(calls.at(-1), ["secondary", "backup-secret"]);
});

test("fixed routing never selects a provider with missing credentials", () => {
  const result = evaluateLlmRoutes("fixed", [{ route: { provider: "a", providerModel: "m", weight: 100, enabled: true }, providerEnabled: false, credentialMissing: true, runtimeAvailable: true, healthScore: 100 }]);
  assert.equal(result.routes[0].selected, false);
  assert.equal(result.routes[0].ineligibleReason, "credential_missing");
  const disabled = evaluateLlmRoutes("fixed", [{ route: { provider: "a", providerModel: "m", weight: 100, enabled: false }, providerEnabled: false, credentialMissing: true, runtimeAvailable: true, healthScore: 100 }]);
  assert.equal(disabled.routes[0].selected, false);
});

test("new providers require a type; unknown legacy providers round-trip", () => {
  const draft = createDefaultLlmConfig();
  draft.providers = [{ ...createEmptyLlmProvider(), key: "new-provider", label: "New", baseUrl: "https://example.test", apiKey: "key" }];
  assert.throws(() => serializeLlmDraft(draft), /必须选择类型/);
  const legacy = cloneLlmConfig({ ...draft, providers: [{ key: "legacy-provider", label: "Legacy", enabled: true, baseUrl: "https://example.test", apiKey: "key", timeoutMs: "30000" }] });
  assert.equal(serializeLlmDraft(legacy).providers[0].type, undefined);
});

test("strict admin updates reject new untyped instances but preserve legacy ones", async () => {
  const kv = await KVManager.create({ backend: new InMemoryKVBackend() });
  const store = new VersionedAppConfigService(new InMemoryDatabase(), new InMemoryCache(), kv);
  const configs = new CommonLlmConfigService(store);
  const provider = { key: "legacy", label: "Legacy", enabled: true, baseUrl: "https://example.test", apiKey: "key", timeoutMs: 30000 };
  const config = { enabled: false, defaultModelKey: "", providers: [provider], models: [] };
  await assert.rejects(configs.updateConfig(config, undefined, { requireTypeForNewProviders: true }), /must specify type/);
  await configs.updateConfig(config);
  await configs.updateConfig(config, undefined, { requireTypeForNewProviders: true });
  await assert.rejects(configs.updateConfig({ ...config, providers: [...config.providers, { ...provider, key: "new", type: "unknown" }] }, undefined, { requireTypeForNewProviders: true }), /Unsupported LLM provider type/);
  await configs.updateConfig({ ...config, providers: [...config.providers, { ...provider, key: "new", type: "openrouter" }] }, undefined, { requireTypeForNewProviders: true });
});

test("concurrent streams on the shared adapter keep each instance credential", async () => {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const matches: boolean[] = [];
  let count = 0;
  const adapter = new OpenRouterOpenAICompatibleProvider({ fetchImplementation: async (_input, init) => {
    const requestBody = JSON.parse(String(init?.body));
    const headers = new Headers(init?.headers);
    const expected = requestBody.model === "vendor/main" ? "Bearer fake-main" : "Bearer fake-backup";
    matches.push(headers.get("Authorization") === expected);
    if (++count === 2) release();
    await barrier;
    return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } });
  } });
  const run = async (provider: string, model: string, key: string) => {
    const request: ResolvedLLMCompletionRequest = { model: { provider, modelKey: "flash", resolvedModelKey: "flash", providerModel: model, providerConfig: { baseUrl: "https://example.test/v1", apiKey: key, timeoutMs: 30000 } }, messages: [{ role: "user", content: "test" }] };
    const events = [];
    for await (const event of adapter.stream(request)) events.push(event.type);
    return events;
  };
  const events = await Promise.all([run("openrouter", "vendor/main", "fake-main"), run("secondary", "vendor/backup", "fake-backup")]);
  assert.deepEqual(matches, [true, true]);
  assert.ok(events.every((item) => item.includes("content_delta") && item.includes("done")));
});

test("circuit failures and recovery state stay isolated by provider instance", async () => {
  const circuit = new LlmRouteCircuitBreakerService(await KVManager.create({ backend: new InMemoryKVBackend() }));
  const main = { modelKey: "flash", provider: "openrouter", providerModel: "vendor/flash", operation: "chat" as const };
  const backup = { ...main, provider: "secondary" };
  for (let i = 0; i < 4; i++) await circuit.recordPreFirstChunkFailure(backup, "test-user", true);
  const confirmation = await circuit.claimCircuitConfirmation(backup);
  assert.ok(confirmation);
  await circuit.completeCircuitConfirmation(confirmation, false);
  assert.equal((await circuit.getRuntimeStatus(backup, true)).state, "open");
  assert.equal((await circuit.getRuntimeStatus(main, true)).state, "closed");
  await circuit.recordFirstEffectiveChunk(main, true);
  assert.equal((await circuit.getRuntimeStatus(backup, true)).state, "open");
});
