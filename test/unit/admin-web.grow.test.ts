import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import test from 'node:test';
import { createAdminServer } from '../../apps/admin-web/server.ts';

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing port');
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

test('Grow proxy preserves URL, writes, origin, redirect and separate cookies', async t => {
  let expectedHost = '';
  const upstream = createServer(async (request, response) => {
    assert.equal(request.url, '/grow/api/auth/login?q=a%2Bb');
    assert.equal(request.headers.host, expectedHost);
    assert.equal(request.headers['x-forwarded-host'], expectedHost);
    assert.equal(request.headers['x-forwarded-proto'], 'https');
    assert.equal(request.headers['x-forwarded-for'], undefined);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(), '{"synthetic":true}');
    response.writeHead(303, { Location: '/grow/', 'Set-Cookie': [
      'grow_session=synthetic; Path=/grow/; HttpOnly; Secure', 'other=1; Path=/grow/'] });
    response.end();
  });
  const target = await listen(upstream);
  const admin = createAdminServer({ growProxyTarget: target });
  const base = await listen(admin);
  expectedHost = new URL(base).host;
  t.after(async () => { await close(admin); await close(upstream); });
  const response = await fetch(base + '/grow/api/auth/login?q=a%2Bb', {
    method: 'POST', body: '{"synthetic":true}', redirect: 'manual', headers: {
      'X-Forwarded-Proto': 'https', 'X-Forwarded-For': 'spoofed',
    },
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/grow/');
  assert.equal(response.headers.getSetCookie().length, 2);
});

test('Grow stream reaches browser before upstream completes', async t => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const upstream = createServer(async (_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write('data: first\n\n');
    await gate;
    response.end('data: last\n\n');
  });
  const admin = createAdminServer({ growProxyTarget: await listen(upstream) });
  const base = await listen(admin);
  t.after(async () => { release(); await close(admin); await close(upstream); });
  const response = await fetch(base + '/grow/api/events');
  const reader = response.body!.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /first/);
  release();
  assert.match(new TextDecoder().decode((await reader.read()).value), /last/);
  assert.equal((await reader.read()).done, true);
});

test('disabled Grow returns explicit 503 and does not fall through to Admin SPA', async t => {
  const admin = createAdminServer();
  const base = await listen(admin);
  t.after(() => close(admin));
  for (const path of ['/grow', '/grow/', '/grow/login']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 503);
    assert.match(await response.text(), /not enabled/);
  }
  assert.equal((await fetch(base + '/_admin/health')).status, 200);
});
