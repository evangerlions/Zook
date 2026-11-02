/** Disposable localhost-only HTTP/PG integration runtime; never imported by production. */
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
const app = await createApplication({ seed, lighttickEnabled: true, lighttickRepository: repository, secureRefreshCookie: false, refreshCookieSameSite: 'Lax', fileStorageRoot: '.artifacts/grow-unified-20261103/fixture-files' });
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
async function close() { web.closeAllConnections(); api.closeAllConnections(); web.close(); api.close(); await pool.end(); process.exit(0); }
process.once('SIGTERM', close); process.once('SIGINT', close);
