import assert from "node:assert/strict";
import test from "node:test";
import { goalProgress, type CompletionFact } from "../../src/modules/frogsleep/buddy-growth/buddy-completion-facts.ts";

const night: CompletionFact = { id: "sunday-night", userId: "alice", kind: "sleep",
  startsAt: "2026-10-18T15:00:00.000Z", occurredAt: "2026-10-18T23:00:00.000Z", minutes: 0 };
const from = "2026-10-18T14:00:00.000Z", end = "2026-10-18T16:00:00.000Z";

test("Sunday sleep completed Monday morning is outside the closed Sunday goal window", () => {
  assert.equal(goalProgress([night], "sleep_schedule_days", "Asia/Shanghai", from, end), 0);
});

test("pausing before a morning completion still freezes the sleep goal", () => {
  assert.equal(goalProgress([night], "sleep_schedule_days", "Asia/Shanghai", from,
    "2026-10-18T15:30:00.000Z"), 0);
});

test("focus completion outside the goal window and sleep starting before consent do not count", () => {
  assert.equal(goalProgress([{ ...night, kind: "focus", minutes: 25 }], "focus_minutes", "Asia/Shanghai", from, end), 0);
  assert.equal(goalProgress([night], "sleep_schedule_days", "Asia/Shanghai", "2026-10-18T15:01:00.000Z", "2026-10-20T00:00:00.000Z"), 0);
});

test("completed shared sleep days deduplicate by the completion day in the goal timezone", () => {
  const second = { ...night, id: "other-night", startsAt: "2026-10-18T16:30:00.000Z", occurredAt: "2026-10-19T00:00:00.000Z" };
  assert.equal(goalProgress([night, second], "sleep_schedule_days", "Asia/Shanghai", from, "2026-10-20T00:00:00.000Z"), 1);
});
