import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAdminServer } from '../../apps/admin-web/server.ts';

async function fixture(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'grow-static-'));
  await mkdir(join(root, 'assets'));
  const files = { 'index.html': '<!doctype html><h1>Grow</h1>', 'assets/app-a1b2c3d4.js': 'console.log("grow")' };
  for (const [name, value] of Object.entries(files)) await writeFile(join(root, name), value);
  const manifest = { schema_version: 1, product: 'lighttick', source_revision: 'a'.repeat(40), contract_revision: 'b'.repeat(40), files: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, createHash('sha256').update(value).digest('hex')])) };
  await writeFile(join(root, 'grow-manifest.json'), JSON.stringify(manifest));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function serve(t: any, options: any) {
  const server = createAdminServer(options);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const address = server.address();
  return `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
}

test('Grow serves fixed static assets, deep links and public runtime config in the existing Web server', async t => {
  const root = await fixture(t); const base = await serve(t, { growEnabled: true, growRoot: root });
  assert.equal((await fetch(base + '/grow', { redirect: 'manual' })).headers.get('location'), '/grow/');
  for (const path of ['/grow/', '/grow/records', '/grow/records/record-1', '/grow/today', '/grow/planning', '/grow/goals', '/grow/actions', '/grow/learning', '/grow/practice']) {
    const response = await fetch(base + path); assert.equal(response.status, 200); assert.match(await response.text(), /Grow/);
  }
  const asset = await fetch(base + '/grow/assets/app-a1b2c3d4.js');
  assert.match(asset.headers.get('cache-control')!, /immutable/);
  assert.equal((await fetch(base + '/grow/assets/app-a1b2c3d4.js', { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(base + '/grow/assets/app-a1b2c3d4.js', { method: 'HEAD' })).body, null);
  const runtime = await fetch(base + '/grow/runtime-config.js');
  assert.match(await runtime.text(), /"appId":"lighttick"/); assert.match(runtime.headers.get('cache-control')!, /no-store/);
  for (const path of ['/grow/api/records', '/grow/assets/missing.js', '/grow/missing', '/grow/grow-manifest.json']) assert.equal((await fetch(base + path)).status, 404, path);
  assert.equal((await fetch(base + '/grow/records', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/_admin/health')).status, 200);
});

test('disabled Grow has no artifact dependency; enabled invalid artifacts fail before listening', async t => {
  const base = await serve(t, { growEnabled: false, growRoot: '/not-present' });
  assert.equal((await fetch(base + '/grow/')).status, 503);
  assert.equal((await fetch(base + '/_admin/health')).status, 200);
  assert.throws(() => createAdminServer({ growEnabled: true, growRoot: '/not-present' } as any));
  const root = await fixture(t); await writeFile(join(root, 'index.html'), 'tampered');
  assert.throws(() => createAdminServer({ growEnabled: true, growRoot: root } as any), /digest/i);
});


test('Grow rejects an artifact symlink that escapes its root even with a matching digest', async t => {
  const root = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'grow-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'app.js'), 'console.log("grow")');
  await rm(join(root, 'assets/app-a1b2c3d4.js'));
  await symlink(join(outside, 'app.js'), join(root, 'assets/app-a1b2c3d4.js'));
  assert.throws(() => createAdminServer({ growEnabled: true, growRoot: root } as any), /escapes/);
});
