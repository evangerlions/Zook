import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLlmSmokeTestMatrix } from '../../src/services/llm-smoke-test-target.ts';
import type { LlmServiceConfig } from '../../src/shared/types.ts';

function config(): LlmServiceConfig {
  return {
    providers: [{ key: 'bailian_token_plan', enabled: true }],
    models: [{ key: 'deepseek-v4-flash', routes: [
      { provider: 'bailian_token_plan', providerModel: 'deepseek-v4-flash-0731', enabled: false, weight: 100 },
      { provider: 'bailian_token_plan', providerModel: 'deepseek-v4.1-flash-1017', enabled: true, weight: 100 },
    ] }],
  } as LlmServiceConfig;
}
const target = { mode: 'route' as const, modelKey: 'deepseek-v4-flash', provider: 'bailian_token_plan' };

test('route smoke chooses the active upstream variant when an earlier variant is disabled', () => {
  const matrix = buildLlmSmokeTestMatrix(config(), target);
  assert.equal(matrix.length, 1);
  assert.equal(matrix[0].route.providerModel, 'deepseek-v4.1-flash-1017');
});

test('route smoke still refuses inactive routes and providers', () => {
  const inactive = config(); inactive.models[0].routes[1].enabled = false;
  assert.throws(() => buildLlmSmokeTestMatrix(inactive, target), /未启用/);
  const disabledProvider = config(); disabledProvider.providers[0].enabled = false;
  assert.throws(() => buildLlmSmokeTestMatrix(disabledProvider, target), /未启用/);
});
