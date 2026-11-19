/** Loopback-only preview of an operator draft. All upstream model calls are mocked. */
import assert from 'node:assert/strict';
import { upgradeKimiModelDraft, KIMI_UPGRADE } from './lib/llm-kimi-upgrade-draft.ts';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApplication } from '../src/application-factory.ts';
import { InMemoryDatabase } from '../src/testing/in-memory-database.ts';
import { InMemoryKVBackend, KVManager } from '../src/infrastructure/kv/kv-manager.ts';
import { LocalAiNovelE2eProvider } from '../src/services/local-ainovel-e2e-provider.ts';
import { consolidateLegacyLlmModels, stageSupportedPlanRoutes } from '../src/services/llm-model-catalog.ts';
import { importAliyunTokenPlanConfig } from '../src/services/aliyun-token-plan-config.ts';
import { LlmSmokeTestService } from "../src/services/llm-smoke-test.service.ts";
import { importBaiConfig } from '../src/services/bai-config.ts';
import { readRequestBody } from '../src/infrastructure/http/request-body.ts';
import { createAdminServer } from '../apps/admin-web/server.ts';
import type { LlmServiceConfig } from '../src/shared/types.ts';

const folder = resolve(process.argv[2] ?? '.zook/llm-local-consolidation');
const read = (name: string) => JSON.parse(readFileSync(resolve(folder, `${name}.json`), 'utf8'));
const source = read('config');
const consolidated = consolidateLegacyLlmModels(source.config as LlmServiceConfig);
const coverage = JSON.parse(readFileSync(new URL("./fixtures/llm-plan-coverage-20261119.json", import.meta.url), "utf8"));
const upgraded = upgradeKimiModelDraft({ llm: consolidated.config, selection: read('selection').config, pricing: read('pricing').config });
const staged = stageSupportedPlanRoutes(upgraded.llm, coverage.entries);
const transformed = { ...consolidated, config: staged.config };
mkdirSync(resolve(folder, 'logs'), { recursive: true });
Object.assign(process.env, {
  APP_ENV: 'local', ADMIN_SESSION_COOKIE_SECURE: 'false', ZOOK_LOCAL_FILE_LOGS: '1',
  ZOOK_LOG_DIR: resolve(folder, 'logs'), ADMIN_BASIC_AUTH_USERNAME: 'local-llm',
  ADMIN_BASIC_AUTH_PASSWORD: 'local-preview-only',
});
const mock = new LocalAiNovelE2eProvider();
const adapters = Object.fromEntries(source.config.providers.map((provider: { key: string; type?: string }) => [provider.type ?? provider.key, mock]));
const kv = await KVManager.create({ backend: new InMemoryKVBackend() });
const runtime = await createApplication({ appEnvironment: 'local', kvManager: kv,
  databaseFactory: seed => new InMemoryDatabase(seed), queueBackend: 'memory',
  adminBasicAuth: { username: 'local-llm', password: 'local-preview-only' },
  llmProviders: adapters, embeddingProviders: adapters,
});
// Use local placeholders for references; no production credentials are copied or revealed.
const references = [...JSON.stringify(source.config).matchAll(/\{\{zook\.ps\.([^}]+)\}\}/g)].map(match => match[1]);
for (const key of new Set(references)) await runtime.services.commonPasswordConfigService.upsertItem({ key, value: 'local-preview-placeholder', desc: 'Local mock only' });
await runtime.services.commonLlmConfigService.updateConfig(source.config, `Read-only online R${source.revision} snapshot; local copy`);
const beforeRevision = (await runtime.services.commonLlmConfigService.getDocument()).revision;
await runtime.services.commonLlmConfigService.updateConfig(transformed.config, 'Local draft: consolidate provider-specific model aliases');
await runtime.services.aiNovelModelPointPricingConfigService.updateConfig(upgraded.pricing, 'Local Kimi upgrade: retain product point amounts');
await runtime.services.aiNovelModelSelectionConfigService.updateConfig(upgraded.selection, 'Local Kimi upgrade: remap model selection references');
const beforeRestart = await runtime.services.commonLlmConfigService.getDocument();
assert.equal(await importAliyunTokenPlanConfig(runtime.services.commonLlmConfigService, runtime.services.commonPasswordConfigService), false);
assert.equal(await importBaiConfig(runtime.services.commonLlmConfigService, runtime.services.commonPasswordConfigService), false);
assert.equal((await runtime.services.commonLlmConfigService.getDocument()).revision, beforeRestart.revision);
const smoke = await runtime.services.llmSmokeTestService.run({ mode: 'matrix' });
assert.ok(smoke.items.length > 0);
assert.ok(smoke.items.every(item => item.status === 'success'));
for (const model of transformed.config.models.filter(model => model.kind === 'chat')) {
  const result = await runtime.services.llmManager.complete({ modelKey: model.key, messages: [{ role: 'user', content: 'Local consolidation routing check' }] });
  assert.equal(result.modelKey, model.key);
}
// Exercise each newly staged target independently, then restore the inactive draft.
const stagedChecks: { modelKey: string; provider: string; providerModel: string; status: string }[] = [];
const probe = new LlmSmokeTestService(runtime.services.commonLlmConfigService, kv, adapters, adapters, { cooldownMs: 0 });
try {
  for (const target of staged.added) {
    const isolated = structuredClone(transformed.config);
    const model = isolated.models.find(model => model.key === target.modelKey)!;
    model.routes = model.routes.map(route => ({ ...route, enabled: route.provider === target.provider && route.providerModel === target.providerModel, weight: 100 }));
    await runtime.services.commonLlmConfigService.updateConfig(isolated, 'Local mock: isolated staged route');
    const result = await probe.run({ mode: 'route', modelKey: target.modelKey, provider: target.provider });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].providerModel, target.providerModel);
    assert.equal(result.items[0].status, 'success');
    stagedChecks.push({ ...target, status: 'success' });
  }
} finally {
  await runtime.services.commonLlmConfigService.updateConfig(transformed.config, 'Restore local draft after mock probes');
}
writeFileSync(resolve(folder, 'candidate.json'), JSON.stringify(transformed.config, null, 2));
writeFileSync(resolve(folder, 'validation.json'), JSON.stringify({ sourceRevision: source.revision,
  upstreamMode: 'mock', beforeModels: source.config.models.length, afterModels: transformed.config.models.length,
  beforeRevision, savedRevision: (await runtime.services.commonLlmConfigService.getDocument()).revision, merged: transformed.merged,
  modelUpgrade: KIMI_UPGRADE,
  coverageVerifiedOn: coverage.verifiedOn, stagedPlanRoutes: staged.added, stagedChecks,
  planCoverage: coverage.entries,
  startupImportIdempotent: true, chatModelChecks: transformed.config.models.filter(model => model.kind === 'chat').length,
  smokeSummary: smoke.summary, smokeTargets: smoke.items.map(({ modelKey, provider, providerModel, status }) => ({ modelKey, provider, providerModel, status })),
}, null, 2));

const api = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1:3186');
    const headers = Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : value]));
    const result = await runtime.app.handle({ method: request.method ?? 'GET', path: url.pathname, headers,
      query: Object.fromEntries(url.searchParams), body: await readRequestBody(request, request.headers['content-type'], 1024 * 1024), ipAddress: '127.0.0.1' });
    response.statusCode = result.statusCode;
    response.setHeader('Content-Type', 'application/json');
    for (const [key, value] of Object.entries(result.headers ?? {})) response.setHeader(key, value);
    response.end(JSON.stringify(result.body));
  } catch { response.statusCode = 400; response.end(JSON.stringify({ message: 'Invalid local request' })); }
});
api.listen(3186, '127.0.0.1');
const admin = createAdminServer({ proxyTarget: 'http://127.0.0.1:3186', brandName: 'Zook LOCAL · 路由模拟' });
admin.listen(3187, '127.0.0.1');
console.log(JSON.stringify({ mode: 'mock upstreams / isolated memory database', sourceRevision: source.revision,
  beforeModels: source.config.models.length, afterModels: transformed.config.models.length, smoke: smoke.summary, addedPlanRoutes: staged.added,
  url: 'http://127.0.0.1:3187/llm', logs: resolve(folder, 'logs') }));
process.once('SIGTERM', () => { api.close(); admin.close(); void runtime.close().then(() => kv.disconnect()).then(() => process.exit(0)); });
