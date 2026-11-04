import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { FrogSleepFocusBuddyService } from "../../src/modules/frogsleep/focus-buddy/focus-buddy.service.ts";

test("focus history and weekly statistics include more than 500 sessions with tied timestamps", async () => {
  const runtime = await createApplication({ frogsleepEnabled: true, queueBackend: "memory",
    databaseFactory: seed => new InMemoryDatabase(seed) });
  const ids = Array.from({ length: 601 }, (_, index) => `history-${String(index).padStart(4, "0")}`);
  const scopedRecords: Array<readonly [string, string, string]> = [
    ...ids.map(id => [id, "user_alice", "frogsleep"] as const),
    ["other-owner", "user_bob", "frogsleep"],
    ["other-app", "user_alice", "app_a"],
  ];
  for (const [id, ownerUserId, appId] of scopedRecords) {
    await runtime.database.insertFrogSleepEntity({ id, appId, kind: "focus_session", ownerUserId,
      status: "completed", startsAt: "2024-01-01T08:00:00.000Z", endsAt: "2024-01-01T08:01:00.000Z",
      createdAt: "2024-01-01T08:01:00.000Z", updatedAt: "2024-01-01T08:01:00.000Z",
      payload: { actual_minutes: 1, minutes: 1 } });
  }
  const service = new FrogSleepFocusBuddyService(runtime.database);
  Object.defineProperty(service, "clock", { value: () => new Date("2024-01-03T12:00:00.000Z") });

  const restoredIds: string[] = [];
  let cursor: string | undefined;
  let hasMore = true;
  for (let pageNumber = 0; pageNumber < 10 && hasMore; pageNumber++) {
    const page = await service.sessions("user_alice", undefined, undefined, { limit: 100, cursor });
    restoredIds.push(...page.sessions.map(session => session.session_id));
    hasMore = page.pagination.has_more;
    if (hasMore) {
      assert.ok(page.pagination.next_cursor);
      assert.notEqual(page.pagination.next_cursor, cursor);
      cursor = page.pagination.next_cursor;
    } else {
      assert.equal(page.pagination.next_cursor, null);
    }
  }
  assert.equal(hasMore, false, "history pagination must reach its final page");
  assert.deepEqual(restoredIds, ids.toReversed());

  const week = await service.weekStats("user_alice");
  assert.equal(week.week_start, "2024-01-01T00:00:00.000Z");
  assert.equal(week.session_count, 601);
  assert.equal(week.completed_count, 601);
  assert.equal(week.total_minutes, 601);
  assert.deepEqual(week.daily, [{ date: "2024-01-01", minutes: 601, session_count: 601 }]);
  assert.deepEqual(await service.weekStats("user_alice", "2024-01-01T08:00:00+08:00"), week);
});
