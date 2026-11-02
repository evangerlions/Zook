import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import test from 'node:test';
import { createAdminServer } from '../../apps/admin-web/server.ts';

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve listening port.'));
        return;
      }
      resolve(address.port);
    });
    server.on('error', reject);
  });
}

test('admin web proxy preserves SSE streaming instead of buffering the whole response', async (t) => {
  let releaseSecondChunk: (() => void) | undefined;
  let upstreamCompleted = false;
  const secondChunkGate = new Promise<void>((resolve) => {
    releaseSecondChunk = resolve;
  });
  const upstream = createServer(async (request, response) => {
    if (request.url !== '/api/test-stream') {
      response.statusCode = 404;
      response.end('not found');
      return;
    }

    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache');
    response.flushHeaders();
    response.write('data: first\n\n');
    await secondChunkGate;
    response.write('data: second\n\n');
    response.end();
    upstreamCompleted = true;
  });
  const upstreamPort = await listen(upstream);
  t.after(() => new Promise((resolve) => upstream.close(() => resolve(undefined))));

  const admin = createAdminServer({ proxyTarget: `http://127.0.0.1:${upstreamPort}` });
  const adminPort = await listen(admin);
  t.after(() => new Promise((resolve) => admin.close(() => resolve(undefined))));

  const response = await fetch(`http://127.0.0.1:${adminPort}/api/test-stream`, {
    headers: { Accept: 'text/event-stream' },
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/i);
  assert.ok(response.body, 'expected a streaming response body');

  const reader = response.body!.getReader();
  const firstChunk = await reader.read();
  assert.equal(firstChunk.done, false);
  assert.match(Buffer.from(firstChunk.value ?? new Uint8Array()).toString('utf8'), /data: first/);
  assert.equal(upstreamCompleted, false, 'expected first SSE chunk before the upstream finished');

  releaseSecondChunk?.();
  const secondChunk = await reader.read();
  assert.equal(secondChunk.done, false);
  assert.match(Buffer.from(secondChunk.value ?? new Uint8Array()).toString('utf8'), /data: second/);

  const completed = await reader.read();
  assert.equal(completed.done, true);
});


test('admin forwards only exact GET handoffs and preserves token query and manual deep-link redirects', async t => {
  const seen: string[] = [];
  const upstream = createServer((request, response) => {
    seen.push(request.url!);
    response.setHeader('Cache-Control', 'public, max-age=3600');
    response.setHeader('Referrer-Policy', 'unsafe-url');
    if (request.url!.startsWith('/frogsleep/buddy-invitation?')) {
      response.setHeader('Content-Type', 'text/html');
      response.end('<a href="frogsleep://buddy-invitation?mode=preview&token=synthetic">Open</a>');
    } else { response.writeHead(302, { Location: 'frogsleep://focus-invite?mode=preview&token=synthetic' }); response.end(); }
  });
  const port = await listen(upstream);
  const admin = createAdminServer({ proxyTarget: `http://127.0.0.1:${port}` });
  const adminPort = await listen(admin);
  t.after(async () => { await new Promise<void>(r => admin.close(() => r())); await new Promise<void>(r => upstream.close(() => r())); });
  const query = '?mode=preview&token=a%2Bb%26c&code=ABC234';
  for (const path of ['/frogsleep/buddy-invitation', '/frogsleep/focus-invite', '/frogsleep/sleep-buddy-invite']) {
    const response = await fetch(`http://127.0.0.1:${adminPort}${path}${query}`, { redirect: 'manual' });
    assert.equal(response.status, path.endsWith('buddy-invitation') ? 200 : 302);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    if (response.status === 200) assert.match(await response.text(), /frogsleep:\/\/buddy-invitation/);
    else assert.match(response.headers.get('location')!, /^frogsleep:/);
    assert.equal(seen.at(-1), path + query);
    assert.equal((await fetch(`http://127.0.0.1:${adminPort}${path}`, { method: 'POST' })).status, 405);
  }
  const before = seen.length;
  await fetch(`http://127.0.0.1:${adminPort}/frogsleep/buddy-invitation/extra`);
  assert.equal(seen.length, before);
});

test('absolute-form requests cannot redirect the proxy to an attacker origin', async t => {
  let attackerRequests = 0, configuredRequests = 0;
  const attacker = createServer((_q, r) => { attackerRequests++; r.end('attacker'); });
  const target = createServer((_q, r) => { configuredRequests++; r.end('configured'); });
  const attackerPort = await listen(attacker), port = await listen(target);
  const admin = createAdminServer({ proxyTarget: `http://127.0.0.1:${port}` });
  const adminPort = await listen(admin);
  t.after(async () => { for (const server of [admin, target, attacker]) await new Promise<void>(r => server.close(() => r())); });
  const body = await new Promise<string>((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port: adminPort,
      path: `http://127.0.0.1:${attackerPort}/frogsleep/buddy-invitation?token=synthetic` }, response => {
      let body = ''; response.on('data', b => { body += b; }); response.on('end', () => resolve(body));
    }); request.on('error', reject); request.end();
  });
  assert.equal(body, 'configured'); assert.equal(configuredRequests, 1); assert.equal(attackerRequests, 0);
});

test('handoff upstream failures retain private headers and do not expose the token', async t => {
  const upstream = createServer(); const port = await listen(upstream);
  await new Promise<void>(r => upstream.close(() => r()));
  const admin = createAdminServer({ proxyTarget: `http://127.0.0.1:${port}` });
  const adminPort = await listen(admin);
  t.after(() => new Promise<void>(r => admin.close(() => r())));
  const response = await fetch(`http://127.0.0.1:${adminPort}/frogsleep/buddy-invitation?token=PRIVATE_SYNTHETIC_TOKEN`);
  assert.equal(response.status, 502); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  const body = await response.text(); assert.doesNotMatch(body, /PRIVATE_SYNTHETIC_TOKEN|127\.0\.0\.1/);
});

test('POST auth challenges preserve upstream 401 and binary request bytes remain intact', async t => {
  const bodies: Buffer[] = [];
  const upstream = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    bodies.push(Buffer.concat(chunks));
    if (request.url === '/api/auth-challenge') {
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="synthetic"', 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ code: 'AUTH_REQUIRED', data: null }));
    } else { response.writeHead(200, { 'Content-Type': 'application/octet-stream' }); response.end(bodies.at(-1)); }
  });
  const apiPort = await listen(upstream);
  const admin = createAdminServer({ proxyTarget: `http://127.0.0.1:${apiPort}` });
  const webPort = await listen(admin);
  t.after(async () => {
    admin.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise<void>(resolve => admin.close(() => resolve())), new Promise<void>(resolve => upstream.close(() => resolve()))]);
  });
  const authBody = JSON.stringify({ appId: 'lighttick', clientType: 'web' });
  const unauthorized = await fetch(`http://127.0.0.1:${webPort}/api/auth-challenge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: authBody });
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).code, 'AUTH_REQUIRED');
  assert.equal(bodies[0].toString(), authBody);
  const bytes = new Uint8Array([0, 255, 241, 128, 10]);
  const binary = await fetch(`http://127.0.0.1:${webPort}/api/binary`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
  assert.equal(binary.status, 200);
  assert.deepEqual(new Uint8Array(await binary.arrayBuffer()), bytes);
});
