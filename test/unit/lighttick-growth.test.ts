import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  buildGrowthOverview,
  businessDayOf,
  startOfWeek,
} from "../../src/modules/lighttick/growth/lighttick-growth.service.ts";

const today = "2026-11-14"; // 周六
const timezone = "Asia/Shanghai";
const build = (tasks: Parameters<typeof buildGrowthOverview>[0], overrides: Partial<{ today: string; heatmapDays: number }> = {}) =>
  buildGrowthOverview(tasks, { today: overrides.today ?? today, timezone, heatmapDays: overrides.heatmapDays });

test("date helpers use Monday as the week start and are stable across month ends", () => {
  assert.equal(startOfWeek("2026-11-14"), "2026-11-09");
  assert.equal(startOfWeek("2026-11-09"), "2026-11-09");
  assert.equal(startOfWeek("2026-11-15"), "2026-11-09");
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
});

test("an empty account still returns a well-formed zeroed overview", () => {
  const overview = build([]);
  assert.equal(overview.today, today);
  assert.equal(overview.week.start, "2026-11-09");
  assert.equal(overview.week.end, "2026-11-15");
  assert.equal(overview.week.days.length, 7);
  assert.equal(overview.recent.days.length, 7);
  assert.equal(overview.heatmap.days.length, 120);
  assert.equal(overview.heatmap.end, today);
  assert.deepEqual(overview.totals, {
    completed: 0,
    minutes: 0,
    active_days: 0,
    current_streak: 0,
    longest_streak: 0,
  });
});

test("planned effort is bucketed by scheduled date, completed effort by completion date", () => {
  const overview = build([
    // 计划今天做，但今天没做完 —— 只进计划口径
    { status: "pending", scheduledFor: today, estimatedMinutes: 30 },
    // 计划在 11-12，实际 11-13 才完成 —— 计划归 12 日，完成归 13 日
    {
      status: "completed",
      scheduledFor: "2026-11-12",
      completedAt: "2026-11-13T02:00:00.000Z",
      estimatedMinutes: 25,
      actualMinutes: 40,
    },
  ]);
  const day = (date: string) => overview.week.days.find((item) => item.date === date)!;
  assert.equal(day(today).planned, 1);
  assert.equal(day(today).completed, 0);
  assert.equal(day("2026-11-12").planned, 1);
  assert.equal(day("2026-11-12").completed, 0);
  assert.equal(day("2026-11-13").completed, 1);
  assert.equal(day("2026-11-13").minutes, 40, "有实测时长时不得退回预估");
  assert.equal(overview.week.planned, 2);
  assert.equal(overview.week.completed, 1);
  assert.equal(overview.week.minutes, 40);
});

test("completed effort falls back to the estimate only when actual duration is unknown", () => {
  const overview = build([
    { status: "completed", scheduledFor: today, completedAt: `${today}T01:00:00.000Z`, estimatedMinutes: 15 },
    { status: "completed", scheduledFor: today, completedAt: `${today}T02:00:00.000Z`, estimatedMinutes: null },
  ]);
  assert.equal(overview.week.completed, 2);
  assert.equal(overview.week.minutes, 15, "缺失预估按 0 计，不得凭空补数");
});

test("cancelled tasks count in neither direction", () => {
  const overview = build([
    { status: "cancelled", scheduledFor: today, estimatedMinutes: 60 },
    { status: "cancelled", scheduledFor: today, completedAt: `${today}T03:00:00.000Z`, estimatedMinutes: 60 },
  ]);
  assert.equal(overview.week.planned, 0);
  assert.equal(overview.week.completed, 0);
  assert.equal(overview.week.minutes, 0);
});

test("timestamps are bucketed in the user's timezone, not UTC", () => {
  // 2026-11-13T23:30Z 在 Asia/Shanghai 是 11-14 07:30
  assert.equal(businessDayOf("2026-11-13T23:30:00.000Z", timezone), "2026-11-14");
  assert.equal(businessDayOf("2026-11-13T23:30:00.000Z", "UTC"), "2026-11-13");
  assert.equal(businessDayOf("2026-11-14", timezone), "2026-11-14");
  assert.equal(businessDayOf(undefined, timezone), null);

  const overview = build([
    { status: "completed", completedAt: "2026-11-13T23:30:00.000Z", estimatedMinutes: 20 },
  ]);
  assert.equal(overview.week.days.find((item) => item.date === today)!.completed, 1);
});

test("a completion without any usable date is not invented into a day bucket", () => {
  const overview = build([{ status: "completed", estimatedMinutes: 20 }]);
  assert.equal(overview.totals.completed, 0, "没有排期也没有完成时间时不得猜测日期");
});

test("current streak counts backwards from today, and from yesterday when today is still empty", () => {
  const completedOn = (date: string) => ({
    status: "completed" as const,
    completedAt: `${date}T02:00:00.000Z`,
    estimatedMinutes: 10,
  });
  const withToday = build([completedOn("2026-11-12"), completedOn("2026-11-13"), completedOn(today)]);
  assert.equal(withToday.totals.current_streak, 3);

  const withoutToday = build([completedOn("2026-11-12"), completedOn("2026-11-13")]);
  assert.equal(withoutToday.totals.current_streak, 2, "今天还没开始不应显示连续中断");
  assert.equal(withoutToday.totals.active_days, 2);
  assert.equal(withoutToday.totals.longest_streak, 2);

  const gap = build([completedOn("2026-11-10"), completedOn("2026-11-12")]);
  assert.equal(gap.totals.current_streak, 0, "昨天没有完成时连续天数应为 0");
  assert.equal(gap.totals.longest_streak, 1);
});

test("heatmap length is bounded and only covers the requested window", () => {
  const overview = build(
    [
      { status: "completed", completedAt: "2026-11-14T02:00:00.000Z", estimatedMinutes: 10 },
      { status: "completed", completedAt: "2026-06-01T02:00:00.000Z", estimatedMinutes: 10 },
    ],
    { heatmapDays: 30 },
  );
  assert.equal(overview.heatmap.days.length, 30);
  assert.equal(overview.heatmap.start, "2026-10-16");
  assert.equal(overview.heatmap.days.at(-1)?.date, today);
  assert.equal(overview.totals.completed, 1, "窗口外的完成不计入总量");
  assert.equal(overview.heatmap.days.filter((day) => day.completed > 0).length, 1);
});
