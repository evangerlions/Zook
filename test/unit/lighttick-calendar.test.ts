import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calendarQuery,
  projectCalendar,
} from "../../src/modules/lighttick/calendar/calendar.service.ts";
const now = new Date("2026-11-15T12:00:00Z");
test("calendar validates month/day/source and keeps leap year boundaries", () => {
  assert.equal(calendarQuery({}, now, "Asia/Shanghai").month, "2026-11");
  assert.equal(
    calendarQuery({ month: "2024-02" }, now, "UTC").end,
    "2024-02-29",
  );
  for (const q of [
    { month: "2026-13" },
    { month: "0000-01" },
    { month: "2026-11", day: "2026-10-31" },
    { month: "2026-02", day: "2026-02-30" },
    { source: "bogus" },
    { page: "0" },
  ])
    assert.throws(() => calendarQuery(q, now, "UTC"));
});
test("calendar keeps source identities, schedule versus actual, deduplicates and paginates deterministically", () => {
  const query = calendarQuery(
    { month: "2026-11", source: "tasks", day: "2026-11-02" },
    now,
    "UTC",
  );
  const base = {
    source: "tasks" as const,
    kind: "task_scheduled",
    date: "2026-11-02",
    date_basis: "scheduled_date",
    title: "任务",
    status: "pending",
    source_id: "same",
    version: "1",
    href: "/grow/plans",
    available: true,
    minutes: null,
  };
  const rows = [
    { ...base, id: "scheduled:same" },
    { ...base, id: "completed:event", kind: "task_completed" },
    { ...base, id: "scheduled:same" },
    { ...base, id: "record:same", source: "records" as const },
  ];
  const p = projectCalendar(rows, query, "UTC", now, 0, []);
  assert.equal(p.total, 2);
  assert.equal(p.days[1].scheduled, 1);
  assert.equal(p.days[1].recorded, 1);
  assert.equal(
    p.days.reduce((n, d) => n + d.scheduled + d.recorded, 0),
    2,
  );
  assert.equal(p.sources.find((s) => s.key === "records")?.count, 1);
  assert.deepEqual(
    p.items.map((i) => i.id),
    ["completed:event", "scheduled:same"],
  );
  const many = Array.from({ length: 23 }, (_, i) => ({
    ...base,
    id: String(i).padStart(2, "0"),
  }));
  const last = projectCalendar(many, { ...query, page: 99 }, "UTC", now, 0, []);
  assert.equal(last.page, 2);
  assert.equal(last.items.length, 3);
});
test("unknown dates are separate from explicitly future-dated records; over-capacity snapshots fail closed", () => {
  const q = calendarQuery({ month: "2026-11" }, now, "UTC");
  const item = {
    id: "a",
    source: "records" as const,
    kind: "record_saved",
    date: "2026-11-16",
    date_basis: "record_date",
    title: "未来补记",
    status: "saved",
    source_id: "a",
    version: "1",
    href: "/grow/records",
    available: true,
    minutes: null,
  };
  assert.equal(
    projectCalendar([item], q, "UTC", now, 2, []).unknown_date_count,
    2,
  );
  assert.throws(() =>
    projectCalendar(
      Array.from({ length: 20001 }, (_, i) => ({ ...item, id: String(i) })),
      q,
      "UTC",
      now,
      0,
      [],
    ),
  );
});
