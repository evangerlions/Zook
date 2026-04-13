import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryKVBackend, KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
import { SmsVerificationCleanupService } from "../../src/services/sms-verification-cleanup.service.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import type { SmsVerificationRecord } from "../../src/shared/types.ts";

function createRecord(id: string, createdAt: string): SmsVerificationRecord {
  return {
    id,
    appId: "flutter_demo",
    scene: "login",
    channel: "sms",
    phoneMasked: "+86****0985",
    phoneHash: `hash-${id}`,
    phoneNa: "+86",
    codePlaintext: "123456",
    status: "test_generated",
    isTest: true,
    provider: "tencent_sms",
    sentAt: createdAt,
    expiresAt: new Date(new Date(createdAt).getTime() + 10 * 60 * 1000).toISOString(),
    revealCount: 0,
    createdAt,
    updatedAt: createdAt,
  };
}

test("shouldRunAt uses a catch-up window after 4am", async () => {
  const database = new InMemoryDatabase();
  const kvManager = await KVManager.create({ backend: new InMemoryKVBackend() });
  const service = new SmsVerificationCleanupService(database, kvManager);

  assert.equal(service.shouldRunAt(new Date("2026-04-13T03:59:00+08:00")), false);
  assert.equal(service.shouldRunAt(new Date("2026-04-13T04:00:00+08:00")), true);
  assert.equal(service.shouldRunAt(new Date("2026-04-13T23:59:00+08:00")), true);
});

test("sms verification cleanup does not run before 4am", async () => {
  const database = new InMemoryDatabase();
  const kvManager = await KVManager.create({ backend: new InMemoryKVBackend() });
  const service = new SmsVerificationCleanupService(database, kvManager);

  const result = await service.runDailyCleanupIfDue(new Date("2026-04-13T03:59:00+08:00"));
  assert.equal(result.ran, false);
  assert.equal(result.deletedCount, 0);
});

test("sms verification cleanup hard-deletes records older than 7 days once after 4am", async () => {
  const database = new InMemoryDatabase({
    smsVerificationRecords: [
      createRecord("old", "2026-04-05T03:00:00+08:00"),
      createRecord("recent", "2026-04-10T09:00:00+08:00"),
    ],
  });
  const kvManager = await KVManager.create({ backend: new InMemoryKVBackend() });
  const service = new SmsVerificationCleanupService(database, kvManager);

  const result = await service.runDailyCleanupIfDue(new Date("2026-04-13T04:01:00+08:00"));
  assert.equal(result.ran, true);
  assert.equal(result.deletedCount, 1);

  const remaining = database.listSmsVerificationRecords();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0]?.id, "recent");
});

test("sms verification cleanup runs at most once per day", async () => {
  const database = new InMemoryDatabase({
    smsVerificationRecords: [
      createRecord("old-1", "2026-04-05T03:00:00+08:00"),
      createRecord("old-2", "2026-04-05T04:00:00+08:00"),
    ],
  });
  const kvManager = await KVManager.create({ backend: new InMemoryKVBackend() });
  const service = new SmsVerificationCleanupService(database, kvManager);

  const first = await service.runDailyCleanupIfDue(new Date("2026-04-13T04:10:00+08:00"));
  const second = await service.runDailyCleanupIfDue(new Date("2026-04-13T09:30:00+08:00"));

  assert.equal(first.ran, true);
  assert.equal(first.deletedCount, 2);
  assert.equal(second.ran, false);
  assert.equal(second.deletedCount, 0);
});
