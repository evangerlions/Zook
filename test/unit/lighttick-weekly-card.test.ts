import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mondayOf,
  weeklyFacts,
  validateWeeklyWrite,
} from "../../src/modules/lighttick/weekly-cards/weekly-card.service.ts";
test("natural week is Monday based and dates reject overflow", () => {
  assert.equal(mondayOf("2026-11-15"), "2026-11-09");
  assert.equal(mondayOf("2026-11-16"), "2026-11-16");
  assert.throws(() => mondayOf("2026-02-30"));
  assert.throws(() => mondayOf("0000-01-03"));
});
test("weekly facts separate complete tasks and minimum attempts and exclude future/foreign event kinds", () => {
  const base = {
    aggregateType: "task",
    id: "a",
    aggregateId: "task",
    occurredAt: "2026-11-15T01:00:00Z",
    payload: { action: "complete", valid_action: true, title: "成果" },
  };
  const facts = weeklyFacts(
    [
      { ...base, eventType: "task_complete" },
      {
        ...base,
        id: "b",
        eventType: "task_minimum_step_recorded",
        payload: {
          action: "minimum_step",
          valid_action: true,
          task_completed: false,
          minimum_step: "标题",
          title: "尝试",
        },
      },
      { ...base, id: "c", eventType: "task_start" },
      {
        ...base,
        id: "d",
        eventType: "task_complete",
        occurredAt: "2026-11-16T00:00:00Z",
      },
    ] as any,
    "2026-11-09",
    "UTC",
    new Date("2026-11-15T12:00:00Z"),
  );
  assert.equal(facts.length, 2);
  assert.deepEqual(
    new Set(facts.map((f) => f.kind)),
    new Set(["completed", "minimum"]),
  );
});
test("weekly confirmation rejects duplicate or more than three selections and a linked adjustment without text", () => {
  const b = {
    base_revision: 0,
    snapshot_hash: "a".repeat(64),
    selected_fact_ids: [],
    review_text: "",
    adjustment_text: "",
    adjustment_target: null,
  };
  assert.ok(validateWeeklyWrite(b));
  for (const x of [
    { ...b, selected_fact_ids: ["a", "a"] },
    { ...b, selected_fact_ids: ["a", "b", "c", "d"] },
    {
      ...b,
      adjustment_target: {
        task_id: "a",
        task_version: 1,
        plan_id: "p",
        plan_version: 1,
        goal_id: "g",
        goal_version: 1,
      },
    },
    { ...b, reward: true },
  ])
    assert.throws(() => validateWeeklyWrite(x));
});
test("week boundaries use the chosen account timezone instead of the UTC date prefix", () => {
  const e = {
    id: "boundary",
    aggregateType: "task",
    aggregateId: "t",
    aggregateVersion: 1,
    eventType: "task_complete",
    occurredAt: "2026-11-16T00:30:00Z",
    payload: { action: "complete", valid_action: true, title: "边界成果" },
  } as any;
  assert.equal(
    weeklyFacts(
      [e],
      "2026-11-09",
      "America/Los_Angeles",
      new Date("2026-11-16T01:00:00Z"),
    ).length,
    1,
  );
  assert.equal(
    weeklyFacts([e], "2026-11-09", "UTC", new Date("2026-11-16T01:00:00Z"))
      .length,
    0,
  );
});
