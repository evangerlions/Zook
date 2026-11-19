import assert from 'node:assert/strict';
import test from 'node:test';
import { addCatalogModels, consolidateLegacyLlmModels } from '../../src/services/llm-model-catalog.ts';
import { addAliyunTokenPlanConfig } from '../../src/services/aliyun-token-plan-config.ts';
import { addBaiConfig } from '../../src/services/bai-config.ts';
import type { LlmModelConfig, LlmServiceConfig } from '../../src/shared/types.ts';
import { createApplication } from '../support/create-test-application.ts';
const model = (key: string, providerModel: string): LlmModelConfig => ({ key, label: key, kind: 'chat', strategy: 'fixed', routes: [{ provider: 'bailian_token_plan', providerModel, enabled: true, weight: 100 }] });

test('consolidation deduplicates aliases while retaining weights, upstream variants and policy', async () => {
  const runtime = await createApplication();
  try {
    const baseline = await runtime.services.commonLlmConfigService.getCurrentConfig();
    const original = model('deepseek-v4-pro', 'deepseek-v4-pro');
    const config = { ...baseline, defaultModelKey: original.key, models: [original,
      model('tokenplan-deepseek-v4-pro', 'deepseek-v4-pro'),
      model('tokenplan-deepseek-v4-pro-0813', 'deepseek-v4-pro-0813')] };
    const before = structuredClone(config);
    const result = consolidateLegacyLlmModels(config);
    assert.equal(result.config.models.length, 1);
    assert.equal(result.merged.length, 2);
    assert.deepEqual(result.config.models[0].routes[0], original.routes[0]);
    assert.deepEqual(result.config.models[0].routes[1], { ...original.routes[0], providerModel: 'deepseek-v4-pro-0813', enabled: false });
    assert.equal(result.config.defaultModelKey, config.defaultModelKey);
    assert.deepEqual(config, before);
    assert.deepEqual(consolidateLegacyLlmModels(result.config).config, result.config);
  } finally { await runtime.close(); }
});

test('new provider routes are staged without redistributing established traffic', () => {
  const current = { ...model('qwen3.6-flash', 'qwen3.6-flash'), routes: [{ provider: 'bailian', providerModel: 'qwen3.6-flash', enabled: true, weight: 100 }] };
  const result = addCatalogModels([current], [model('qwen3.6-flash', 'qwen3.6-flash')]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].routes[0], current.routes[0]);
  assert.equal(result[0].routes[1].enabled, false);
  assert.deepEqual(addCatalogModels(result, [model('qwen3.6-flash', 'qwen3.6-flash')]), result);
});

test('existing providers respect operator deletions and never recreate provider-prefixed models', () => {
  const config = { providers: [{ key: 'bailian_token_plan' }, { key: 'bai' }], models: [] } as unknown as LlmServiceConfig;
  assert.equal(addAliyunTokenPlanConfig(config), undefined);
  assert.equal(addBaiConfig(config), undefined);
});

test('catalog merge keeps OpenRouter policies and required upstream suffixes intact', () => {
  const original: LlmModelConfig = { ...model('minimax-m3', 'minimax/minimax-m3:free'),
    strategy: 'auto', routes: [{ provider: 'openrouter', providerModel: 'minimax/minimax-m3:free', enabled: true, weight: 100,
      openRouter: { provider: { order: ['deepinfra'], allow_fallbacks: false } } }] };
  const result = addCatalogModels([original], [model('glm-5.3-flash', 'glm-5.3-flash')]);
  assert.deepEqual(result[0], original);
  assert.notEqual(result[0], original);
});

test('documented plan coverage stages variants on existing identities without activating traffic', async () => {
  const { stageSupportedPlanRoutes } = await import('../../src/services/llm-model-catalog.ts');
  const runtime = await createApplication();
  try {
    const baseline = await runtime.services.commonLlmConfigService.getCurrentConfig();
    const original = { ...model('deepseek-v4-flash', 'deepseek-v4-flash-0731'),
      routes: [{ provider: 'bailian_token_plan', providerModel: 'deepseek-v4-flash-0731', enabled: true, weight: 100 }] };
    const config = { ...baseline, defaultModelKey: original.key, providers: [{ key: 'bailian_token_plan', type: 'bailian_token_plan', label: 'Plan', enabled: true, baseUrl: 'https://example.com/v1', apiKey: 'local-placeholder', timeoutMs: 30000 }], models: [original] };
    const entries = [{ provider: 'bailian_token_plan', modelKey: original.key, providerModels: ['deepseek-v4-flash-0731', 'deepseek-v4.1-flash', 'deepseek-v4.1-flash-1017'], availability: 'listed' as const }];
    const staged = stageSupportedPlanRoutes(config, entries);
    assert.equal(staged.config.models.length, 1);
    assert.equal(staged.added.length, 2);
    assert.deepEqual(staged.config.models[0].routes[0], original.routes[0]);
    assert.ok(staged.config.models[0].routes.slice(1).every(route => !route.enabled));
    assert.equal(stageSupportedPlanRoutes(staged.config, entries).added.length, 0);
    await runtime.services.commonLlmConfigService.updateConfig(staged.config, 'Validate staged plan routes');
  } finally { await runtime.close(); }
});
