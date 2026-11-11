import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { createApplication } from '../support/create-test-application.ts';

const key = Buffer.alloc(32, 7);
function encryptedLine(tsMs: number, message: string) {
  const plain = Buffer.from(JSON.stringify({ tsMs, level: 'info', module: 'acceptance', message }) + '\n');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const compressed = gzipSync(plain);
  return { nonce: nonce.toString('base64'), body: Buffer.concat([cipher.update(compressed), cipher.final(), cipher.getAuthTag()]) };
}

test('feedback log snapshot enforces owner, device, time window and one successful upload', async () => {
  const runtime = await createApplication({
    fileStorageRoot: mkdtempSync(join(tmpdir(), 'zook-feedback-log-')),
    logEncryptionKeyResolver: { resolveKey: () => key },
  });
  const alice = await runtime.services.authService.login({ appId: 'ai_novel', account: 'alice@example.com', password: 'Password1234' });
  const bob = await runtime.services.authService.login({ appId: 'ai_novel', account: 'bob@example.com', password: 'Password1234' });
  const submitted = await runtime.app.handle({ method: 'POST', path: '/api/v1/ai_novel/feedback',
    headers: { authorization: `Bearer ${alice.accessToken}`, 'x-did': 'device-a' },
    body: { message: 'This detailed feedback requests a diagnostic log snapshot.', includeDiagnosticLogs: true, metadata: { deviceModel: 'test-device' } },
  });
  assert.equal(submitted.statusCode, 200);
  const task = submitted.body.data.logTask;
  const payload = encryptedLine(task.toTsMs, 'feedback-snapshot-test-marker');
  const request = (token: string, did: string, encrypted: ReturnType<typeof encryptedLine>) => ({
    method: 'POST', path: '/api/v1/logs/upload', body: encrypted.body,
    headers: { authorization: `Bearer ${token}`, 'x-app-id': 'ai_novel', 'x-did': did,
      'x-log-task-id': task.taskId, 'x-log-claim-token': task.claimToken,
      'x-log-key-id': task.keyId, 'x-log-enc': 'aes-256-gcm',
      'x-log-nonce': encrypted.nonce, 'x-log-content': 'ndjson+gzip' },
  });
  assert.notEqual((await runtime.app.handle(request(bob.accessToken, 'device-a', payload))).statusCode, 200);
  assert.notEqual((await runtime.app.handle(request(alice.accessToken, 'device-b', payload))).statusCode, 200);
  assert.notEqual((await runtime.app.handle(request(alice.accessToken, 'device-a', encryptedLine(task.fromTsMs - 1, 'out of window')))).statusCode, 200);
  const attempts = await Promise.all([runtime.app.handle(request(alice.accessToken, 'device-a', payload)), runtime.app.handle(request(alice.accessToken, 'device-a', payload))]);
  assert.equal(attempts.filter((response) => response.statusCode === 200).length, 1);
  const stored = await runtime.database.findClientLogUploadTask(task.taskId);
  assert.equal(stored?.status, 'COMPLETED');
  assert.match(readFileSync(stored!.uploadedFilePath!, 'utf8'), /feedback-snapshot-test-marker/);
  const listed = await runtime.services.feedbackService.listAdminFeedback();
  assert.equal(listed.items[0]?.logTask?.taskId, task.taskId);
  assert.equal(listed.items[0]?.metadata?.deviceModel, 'test-device');
  assert.equal(listed.items[0]?.logTask?.hasFile, true);
});
