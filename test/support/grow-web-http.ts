/** Disposable localhost-only HTTP/PG integration runtime; never imported by production. */
import { LightTickWorker } from '../../src/modules/lighttick/lighttick-worker.ts';
import { LightTickAiRunner } from '../../src/modules/lighttick/ai/lighttick-ai-runner.ts';
import { createServer } from 'node:http';
import { Pool } from 'pg';
import { createApplication } from './create-test-application.ts';
import { buildDefaultSeed } from '../../src/infrastructure/database/prisma/default-seed.ts';
import { PostgresLightTickRepository } from '../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts';
import { runPostgresMigrations } from '../../src/infrastructure/database/postgres/migrate.ts';
import { createAdminServer } from '../../apps/admin-web/server.ts';
import { readRequestBody } from '../../src/infrastructure/http/request-body.ts';
const dsn = process.env.GROW_WEB_TEST_DSN;
if (!dsn || !['127.0.0.1', 'localhost'].includes(new URL(dsn).hostname) || !/^\/grow_web_u1_[a-f0-9]+$/.test(new URL(dsn).pathname)) throw Error('Dedicated disposable localhost database required');
await runPostgresMigrations({ connectionString: dsn, log: () => {} });
const pool = new Pool({ connectionString: dsn });
const repository = new PostgresLightTickRepository(pool);
const seed = buildDefaultSeed(undefined, { includeLightTick: true });
for (const userId of ['user_alice', 'user_bob']) seed.appUsers.push({ id: 'grow-web-' + userId, appId: 'lighttick', userId, status: 'ACTIVE', accountRegion: 'UNKNOWN', joinedAt: new Date().toISOString() });
if (process.env.GROW_WEB_TEST_AI === 'synthetic') {
 const config=seed.appConfigs.find(c=>c.appId==='lighttick'&&c.configKey==='admin.delivery_config')!;
 const value=JSON.parse(config.configValue);value.enabled=true;value.featureFlags.conversationalPlanning=true;config.configValue=JSON.stringify(value);
 if(process.env.GROW_WEB_TEST_PORT){value.settings={...value.settings,growWebUrl:'http://127.0.0.1:'+process.env.GROW_WEB_TEST_PORT+'/grow/'};config.configValue=JSON.stringify(value);}
}
const app = await createApplication({ seed, lighttickEnabled: true, lighttickRepository: repository, secureRefreshCookie: false, refreshCookieSameSite: 'Lax', fileStorageRoot: '.artifacts/grow-unified-20261103/fixture-files' });
let queueTimer: ReturnType<typeof setInterval> | undefined;
if (process.env.GROW_WEB_TEST_AI === 'synthetic') {
  const runtime = app.services.lighttickRuntime!;
  runtime.planningEnabled = true;
  runtime.worker = new LightTickWorker(new LightTickAiRunner(repository, { complete: async (input: any) => ({ provider: 'synthetic', providerModel: 'synthetic', text: JSON.stringify(input.messages.some((m: any) => m.content.includes('"planning_action":"messages"')) ? {message: '请核对投入与日期，再审阅草案。',fields: {}} : {tasks: [{title:'合成规划步骤',estimated_minutes:5,scheduled_for:'2030-01-01T09:00:00Z',completion_criteria:'写下一条具体结论',steps:['打开笔记','写下结论']}]}) }) } as any));
  let running=false;
  queueTimer=setInterval(()=>{ if(running)return; running=true; void app.queue.processDueJobs(job=>runtime.worker!.process(job),new Date()).catch(()=>{}).finally(()=>{running=false;}); },100);
}
const api = createServer(async (request, response) => {
  try {
    const url = new URL(request.url!, 'http://127.0.0.1');
    const result = await app.app.handle({ method: request.method!, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])), body: await readRequestBody(request, request.headers['content-type']), ipAddress: '127.0.0.1' });
    response.writeHead(result.statusCode, { 'Content-Type': 'application/json', ...result.headers }); response.end(JSON.stringify(result.body));
  } catch { response.writeHead(500); response.end('{"code":"FIXTURE_FAILED"}'); }
});
await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve));
const address = api.address(); if (!address || typeof address === 'string') throw Error('Missing address');
const web = createAdminServer({ proxyTarget: 'http://127.0.0.1:' + address.port, growEnabled: true, growRoot: 'static/grow' });
await new Promise<void>(resolve => web.listen(Number(process.env.GROW_WEB_TEST_PORT ?? 0), '127.0.0.1', resolve));
const webAddress = web.address();
console.log(JSON.stringify({ ready: true, api: 'http://127.0.0.1:' + address.port, web: 'http://127.0.0.1:' + (typeof webAddress === 'object' && webAddress ? webAddress.port : 0) }));
async function close() { if(queueTimer)clearInterval(queueTimer); web.closeAllConnections(); api.closeAllConnections(); web.close(); api.close(); await pool.end(); process.exit(0); }
process.once('SIGTERM', close); process.once('SIGINT', close);
