import assert from "node:assert/strict";
import test from "node:test";
import { ContentSafetyRecordStore } from "../../src/services/content-safety-records.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import type { ContentSafetyConfig } from "../../src/shared/types.ts";

const now = () => new Date("2026-10-09T00:00:00Z");
const config = { longTextThresholdChars: 2000 } as ContentSafetyConfig;

test("only blocked inputs persist; records reads and writes never clean up inline", async () => {
  const database = new InMemoryDatabase();
  database.deleteContentSafetyCheckRecordsCreatedBefore = () => { throw new Error("Inline cleanup forbidden"); };
  const store = new ContentSafetyRecordStore(database, undefined, now);
  const command = { appId: "test", text: "text" };
  for (const decision of ["pass", "failed_open", "block"] as const) {
    await store.recordCheck(command, config, { method: "llm", decision, text: "text", blockedText: "text" });
  }
  assert.equal(database.contentSafetyCheckRecords.length, 1);
  assert.equal(database.contentSafetyCheckRecords[0].decision, "block");
  assert.equal((await store.listBlockRecords({})).items.length, 1);
});

test("retention cleanup runs separately from request paths", async () => {
  const database = new InMemoryDatabase();
  const oldStore = new ContentSafetyRecordStore(database, undefined, () => new Date("2026-08-01T00:00:00Z"));
  await oldStore.recordCheck({ appId: "test", text: "text" }, config, { method: "keyword", decision: "block", text: "text" });
  await new ContentSafetyRecordStore(database, undefined, now).cleanupExpiredRecords();
  assert.equal(database.contentSafetyCheckRecords.length, 0);
});
