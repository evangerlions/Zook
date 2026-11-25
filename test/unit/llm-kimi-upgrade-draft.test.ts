import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLlmConfigWritePlan } from '../../scripts/lib/llm-config-write-plan.ts';
import { createDefaultOpenRouterConfig } from '../../src/services/openrouter-config.ts';
import { createDefaultBaiConfig } from '../../src/services/bai-transparent-proxy-config.ts';
import { upgradeKimiModelDraft, KIMI_UPGRADE } from '../../scripts/lib/llm-kimi-upgrade-draft.ts';
import type { LlmServiceConfig } from '../../src/shared/types.ts';

function fixture() {
  const providers = ['volcengine_agent_plan', 'bai', 'openrouter', 'openrouter_backup'].map(key => ({
    key, type: key === 'openrouter_backup' ? 'openrouter' : key, label: key, enabled: true,
    baseUrl: 'https://example.com/v1', apiKey: 'local-only', timeoutMs: 30000,
  }));
  const llm: LlmServiceConfig = { enabled: true, defaultModelKey: 'kimi-k3', providers,
    openRouter: createDefaultOpenRouterConfig(), bai: createDefaultBaiConfig(),
    routeCircuitBreaker: { enabled: false }, emailAlerts: { llmEnabled: true, aiNovelFeedbackEnabled: true },
    models: [{ key: 'kimi-k3', label: 'Kimi K3', kind: 'chat', strategy: 'auto',
      routes: providers.map((provider, i) => ({ provider: provider.key,
        providerModel: provider.type === 'openrouter' ? 'moonshotai/kimi-k3' : 'kimi-k3',
        enabled: true, weight: [24, 6, 21, 49][i],
        ...(provider.type === 'openrouter' ? { openRouter: { provider: { allow_fallbacks: false, order: ['moonshotai'] } } } : {}),
      })) }] };
  return { llm, selection: { schemaVersion: 1 as const, autoFree: { enabled: true },
    chat: { default: [{ modelKey: 'kimi-k3', weight: 100 }] },
    catalog: [{ modelKey: 'kimi-k3', label: 'Kimi K3', localIcon: 'kimi', sortOrder: 2 }] },
    pricing: { schemaVersion: 1 as const, tokensPerPoint: 15_000, models: [{ modelKey: 'kimi-k3', inputPointsPerMillionTokens: 350,
      outputPointsPerMillionTokens: 4350, cachedInputPointsPerMillionTokens: 250,
      contextTiers: [{ abovePromptTokens: 32000, inputPointsPerMillionTokens: 400, outputPointsPerMillionTokens: 5000 }] }] } };
}

test('Kimi upgrade replaces the logical model and all provider instances without changing traffic policy', () => {
  const source = fixture();
  const before = structuredClone(source);
  const result = upgradeKimiModelDraft(source);
  assert.deepEqual(source, before);
  assert.equal(result.llm.models.length, 1);
  assert.equal(result.llm.models[0].key, KIMI_UPGRADE.to);
  assert.equal(result.llm.models[0].label, KIMI_UPGRADE.label);
  assert.equal(result.llm.defaultModelKey, KIMI_UPGRADE.to);
  assert.deepEqual(result.llm.providers, source.llm.providers);
  for (const [i, route] of result.llm.models[0].routes.entries()) {
    assert.deepEqual(route, { ...source.llm.models[0].routes[i], providerModel:
      route.provider.startsWith('openrouter') ? 'moonshotai/kimi-k3.1-pro' : 'kimi-k3.1-pro' });
  }
  assert.deepEqual(result.selection.chat.default, [{ modelKey: KIMI_UPGRADE.to, weight: 100 }]);
  assert.deepEqual(result.selection.catalog, [{ ...source.selection.catalog[0], modelKey: KIMI_UPGRADE.to, label: KIMI_UPGRADE.label }]);
  assert.deepEqual(result.selection.autoFree, source.selection.autoFree);
  assert.equal(result.pricing.tokensPerPoint, source.pricing.tokensPerPoint);
  assert.deepEqual(result.pricing.models, [{ ...source.pricing.models[0], modelKey: KIMI_UPGRADE.to }]);
  assert.deepEqual(upgradeKimiModelDraft(result), result);
});

test('upgrade preserves unrelated models, defaults and point prices', () => {
  const source = fixture();
  source.llm.defaultModelKey = 'other';
  source.llm.models.push({ ...structuredClone(source.llm.models[0]), key: 'other' });
  const result = upgradeKimiModelDraft(source);
  assert.equal(result.llm.defaultModelKey, 'other');
  assert.deepEqual(result.llm.models[1], source.llm.models[1]);
});

test('conflicting target references fail before a partial draft can be saved', () => {
  for (const location of ['llm', 'selection', 'catalog', 'pricing']) {
    const source = fixture();
    if (location === 'llm') source.llm.models.push({ ...source.llm.models[0], key: KIMI_UPGRADE.to });
    if (location === 'selection') source.selection.chat.default.push({ modelKey: KIMI_UPGRADE.to, weight: 0 });
    if (location === 'catalog') source.selection.catalog.push({ ...source.selection.catalog[0], modelKey: KIMI_UPGRADE.to });
    if (location === 'pricing') source.pricing.models.push({ ...source.pricing.models[0], modelKey: KIMI_UPGRADE.to });
    assert.throws(() => upgradeKimiModelDraft(source), /target .* already exists/);
  }
});

test('an unverified upstream cannot leave an old K3 route under the new logical identity', () => {
  const source = fixture();
  source.llm.models[0].routes.push({ provider: 'bailian_token_plan', providerModel: 'kimi-k3', enabled: true, weight: 1 });
  assert.throws(() => upgradeKimiModelDraft(source), /no verified upstream for bailian_token_plan/);
  assert.equal(source.llm.models[0].key, 'kimi-k3');
});

test('Admin HTTP write plan preserves pricing and selected models through each Kimi upgrade phase', async () => {
  const { createApplication } = await import('../support/create-test-application.ts');
  const runtime = await createApplication({ adminBasicAuth: { username: 'operator', password: 'test-only' } });
  const source = fixture();
  const target = upgradeKimiModelDraft(source);
  const { commonLlmConfigService: llm, aiNovelModelPointPricingConfigService: pricing,
    aiNovelModelSelectionConfigService: selection } = runtime.services;
  try {
    await llm.updateConfig(source.llm);
    await pricing.updateConfig(source.pricing);
    await selection.updateConfig(source.selection);
    const login = await runtime.app.handle({ method: 'POST', path: '/api/v1/admin/auth/login',
      headers: {}, body: { username: 'operator', password: 'test-only' } });
    assert.equal(login.statusCode, 200);
    const cookie = login.headers?.['Set-Cookie'];
    assert.ok(cookie);
    for (const step of buildLlmConfigWritePlan(source, target, 'Test HTTP upgrade')) {
      const response = await runtime.app.handle({ method: 'PUT', path: '/api/v1/admin' + step.path,
        headers: { cookie }, body: step.body });
      assert.equal(response.statusCode, 200);
      // Compare public structure, ignoring the expected masking of fixture API keys.
      const saved = (response.body as { data: { config: typeof step.config } }).data.config;
      if (step.key === 'llm') {
        assert.equal((saved as LlmServiceConfig).enabled, true);
        assert.deepEqual((saved as LlmServiceConfig).models, (step.config as LlmServiceConfig).models);
      } else assert.deepEqual(saved, step.config);
      const selected = await selection.resolveChatModelKey();
      assert.equal((await pricing.resolveModelPointPricing('ai_novel', selected))?.tokensPerPoint, source.pricing.tokensPerPoint);
    }
    assert.equal(await selection.resolveChatModelKey(), KIMI_UPGRADE.to);
    assert.deepEqual(await pricing.resolveModelPointPricing('ai_novel', KIMI_UPGRADE.to), {
      tokensPerPoint: source.pricing.tokensPerPoint,
      inputPointsPerMillionTokens: 350, outputPointsPerMillionTokens: 4350,
      cachedInputPointsPerMillionTokens: 250, contextTiers: source.pricing.models[0].contextTiers,
    });
    assert.equal(await pricing.resolveModelPointPricing('ai_novel', KIMI_UPGRADE.from), undefined);
    assert.deepEqual((await selection.getPublicModels()).map(model => model.key), [KIMI_UPGRADE.to]);
  } finally { await runtime.close(); }
});
