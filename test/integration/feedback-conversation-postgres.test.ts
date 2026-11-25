import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
import { FilePurgeService } from "../../src/infrastructure/files/file-purge.service.ts";
import { PersistentFileStore } from "../../src/infrastructure/files/persistent-file-store.ts";

const databaseUrl = process.env.FEEDBACK_TEST_DATABASE_URL?.trim();
const redisUrl = process.env.FEEDBACK_TEST_REDIS_URL?.trim();
const fixtureAvailable = Boolean(databaseUrl && redisUrl);
const imageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lH2m8QAAAABJRU5ErkJggg==";
const image = { fileName: "screen.png", mimeType: "image/png", contentBase64: imageBase64, sizeBytes: Buffer.from(imageBase64, "base64").length };
const path = "/api/v1/ai_novel/feedback";

test("feedback migrations, PostgreSQL reply durability and Redis concurrency", { skip: !fixtureAvailable }, async t => {
  const wallClock = Date.now;
  t.mock.timers.enable({ apis: ["Date"], now: Math.floor(wallClock() / 60_000) * 60_000 + 1_000 });
  const fileStorageRoot = mkdtempSync(join(tmpdir(), "zook-feedback-postgres-"));
  t.after(() => rmSync(fileStorageRoot, { recursive: true, force: true }));
  const kvManager = await KVManager.create({ redisUrl });
  t.after(() => kvManager.disconnect());
  const runtime = await createApplication({
    appEnvironment: "test", databaseUrl, migrationDatabaseUrl: databaseUrl, kvManager, queueBackend: "memory", fileStorageRoot,
    adminBasicAuth: { username: "admin", password: "AdminPass123!" },
  });
  t.after(() => runtime.database.close());
  const session = await runtime.services.authService.login({ appId: "ai_novel", account: "alice@example.com", password: "Password1234" });
  const user = { authorization: `Bearer ${session.accessToken}` };
  const adminLogin = await runtime.app.handle({ method: "POST", path: "/api/v1/admin/auth/login", headers: {}, body: { username: "admin", password: "AdminPass123!" } });
  assert.equal(adminLogin.statusCode, 200);
  const admin = { cookie: adminLogin.headers?.["Set-Cookie"] };
  const initial = await runtime.app.handle({
    method: "POST", path, headers: user, body: { message: "Persistent feedback from a test account." },
  });
  assert.equal(initial.statusCode, 200, initial.body.message);
  const id = initial.body.data.id as string;
  const adminThread = `/api/v1/admin/apps/ai_novel/feedback/${id}`;
  const sendAdmin = await runtime.app.handle({
    method: "POST", path: `${adminThread}/messages`, headers: admin,
    body: { attachments: [image], submissionKey: "pg_admin_feedback_reply_1", close: true },
  });
  assert.equal(sendAdmin.statusCode, 200, sendAdmin.body.message);
  const concurrencyRequest = {
    method: "POST", path: `${path}/${id}/messages`, headers: user,
    body: { message: "Thanks", attachments: [image], submissionKey: "pg_user_feedback_reply_shared" },
  };
  const retries = await Promise.all(Array.from({ length: 5 }, () => runtime.app.handle(concurrencyRequest)));
  assert.ok(retries.every(result => result.statusCode === 200 && result.body.data.id === retries[0]!.body.data.id), JSON.stringify(retries.map(result => result.body)));
  const concurrentPosts = await Promise.all(Array.from({ length: 13 }, (_, index) =>
    runtime.app.handle({
      ...concurrencyRequest, body: { message: `Follow-up ${index}`, submissionKey: `pg_user_feedback_reply_${index}` },
    })));
  assert.equal(concurrentPosts.filter(result => result.statusCode === 200).length, 9, JSON.stringify(concurrentPosts.map(result => result.statusCode)));
  assert.equal(concurrentPosts.filter(result => result.statusCode === 429).length, 4);

  const detail = await runtime.app.handle({ method: "GET", path: `${path}/${id}`, headers: user });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.body.data.messages.length, 12);
  const replyAttachment = detail.body.data.messages[1].attachments[0];
  const attachment = await runtime.app.handle({ method: "GET", path: `${path}/${id}/attachments/${replyAttachment.id}`, headers: user });
  assert.equal(attachment.body.data.contentBase64, imageBase64);
  assert.equal((await runtime.app.handle({ method: "GET", path: "/api/v1/admin/apps/ai_novel/feedback", headers: admin })).body.data.items[0].status, "done");
  const userId = "user_alice";
  const file = await runtime.database.findFeedbackAttachment("ai_novel", id, replyAttachment.id);
  assert.ok(file);
  const files = new PersistentFileStore(fileStorageRoot);
  const purge = new FilePurgeService(runtime.database, files, () => new Date(wallClock()));
  await runtime.database.enqueueFilePurge("ai_novel", userId, file.storagePath);
  assert.equal((await purge.runBatch()).retained, 1);
  await runtime.database.withAppUserDataTransaction("ai_novel", userId,
    () => runtime.database.deleteAppUserRuntimeData("ai_novel", userId));
  assert.equal(await runtime.database.getFeedbackConversationStore().find("ai_novel", id, userId), undefined);
  assert.equal((await purge.runBatch()).removed, 2);
  await assert.rejects(files.readBuffer(file.storagePath), { code: "ENOENT" });
});
