import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { FrogSleepProductDataService } from "../../src/modules/frogsleep/product-data/frogsleep-product-data.service.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

async function restoreEveryReport(service: FrogSleepProductDataService, userId: string) {
  const reports: Record<string, unknown>[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < 30; pageNumber += 1) {
    const page = await service.listSleepReports(userId, { limit: 100, cursor });
    assert.ok(page.sleep_reports.length <= 100);
    reports.push(...page.sleep_reports);
    if (!page.pagination.has_more) {
      assert.equal(page.pagination.next_cursor, null);
      return reports;
    }
    assert.ok(page.pagination.next_cursor, "nonfinal page must supply a cursor");
    assert.equal(seenCursors.has(page.pagination.next_cursor), false, "cursor must advance");
    seenCursors.add(page.pagination.next_cursor);
    cursor = page.pagination.next_cursor;
  }
  assert.fail("history pagination did not terminate");
}

for (const scenario of [{ count: 501, sameTimestamp: false }, { count: 1100, sameTimestamp: true }]) {
  test(`restores all ${scenario.count} sleep reports${scenario.sameTimestamp ? " across equal timestamp boundaries" : " beyond the legacy 500 cap"}`, async () => {
    const database = new InMemoryDatabase(buildDefaultSeed(undefined, { includeFrogSleep: true }));
    const service = new FrogSleepProductDataService(database);
    const expected = new Set<string>();
    for (let index = 0; index < scenario.count; index += 1) {
      const snapshotId = `alice-${String(index).padStart(4, "0")}`;
      expected.add(snapshotId);
      await service.createSleepReport("user_alice", { snapshot_id: snapshotId, schema_version: "1",
        recorded_at: new Date(Date.UTC(2026, 0, 1) + (scenario.sameTimestamp ? 0 : index * 60000)).toISOString(),
        data: { night: index } });
    }
    await service.createSleepReport("user_bob", { snapshot_id: "bob-private", schema_version: "1",
      recorded_at: "2027-01-01T00:00:00.000Z", data: { private: true } });
    const restored = await restoreEveryReport(service, "user_alice");
    const snapshots = restored.map((report) => String(report.snapshot_id));
    assert.equal(restored.length, scenario.count, "every uploaded report must survive cloud restoration");
    assert.equal(new Set(snapshots).size, scenario.count, "page boundaries must never duplicate reports");
    assert.deepEqual(new Set(snapshots), expected, "restore must preserve identity and ownership");
    const bobReports = await restoreEveryReport(service, "user_bob");
    assert.deepEqual(bobReports.map((report) => report.snapshot_id), ["bob-private"]);
    assert.deepEqual(await restoreEveryReport(service, "user_without_reports"), []);
  });
}
