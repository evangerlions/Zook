import assert from "node:assert/strict";
import test from "node:test";
import { ContentSafetyRecordStore } from "../../src/services/content-safety-records.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

const fixedNow = new Date("2026-06-10T00:00:00.000Z");

test("content safety stats group UTC records by Asia/Shanghai date", async () => {
  const database = new InMemoryDatabase();
  const store = new ContentSafetyRecordStore(database, undefined, () => fixedNow);
  database.insertContentSafetyCheckRecord(
    createRecord({
      id: "csf_timezone_shanghai",
      createdAt: "2026-05-20T16:30:00.000Z",
    }),
  );

  const stats = await store.getStats({
    dateFrom: "2026-05-21",
    dateTo: "2026-05-21",
    source: "admin_test",
    taskType: "timezone_stats_test",
  });

  assert.equal(stats.summary.total, 1);
  assert.deepEqual(stats.daily, [
    {
      date: "2026-05-21",
      total: 1,
      passed: 1,
      blocked: 0,
      failedOpen: 0,
    },
  ]);
});

test("content safety stats remove records older than 30 days", async () => {
  const database = new InMemoryDatabase();
  const store = new ContentSafetyRecordStore(database, undefined, () => fixedNow);
  database.insertContentSafetyCheckRecord(
    createRecord({
      id: "csf_expired",
      createdAt: "2026-05-10T23:59:59.999Z",
    }),
  );
  database.insertContentSafetyCheckRecord(
    createRecord({
      id: "csf_retained",
      createdAt: "2026-05-11T00:00:00.000Z",
    }),
  );

  const stats = await store.getStats({
    dateFrom: "2026-05-01",
    dateTo: "2026-06-10",
    source: "admin_test",
    taskType: "timezone_stats_test",
  });

  assert.equal(stats.summary.total, 1);
  assert.deepEqual(
    database.contentSafetyCheckRecords.map((record) => record.id),
    ["csf_retained"],
  );
});

function createRecord({ id, createdAt }: { id: string; createdAt: string }) {
  return {
    id,
    appId: "admin",
    taskType: "timezone_stats_test",
    source: "admin_test" as const,
    method: "disabled" as const,
    decision: "pass" as const,
    textLength: 2,
    textHash: `${id}_hash`,
    metadata: {},
    createdAt,
  };
}
