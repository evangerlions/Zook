import assert from 'node:assert/strict';
import { createServer } from 'node:http';
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
