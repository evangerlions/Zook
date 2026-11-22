import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRhythmCommand } from "../../src/modules/lighttick/today-focus/daily-rhythm.service.ts";
const base = {
  request_key: "rhythm-original",
  base_version: 1,
  business_date: "2026-11-15",
  timezone: "UTC",
  task_id: "task-a",
  task_version: 1,
};
test("minimum mode needs a concrete step; rest/standard cannot carry disguised completion", () => {
  assert.equal(
    validateRhythmCommand({
      ...base,
      action: "mode",
      mode: "minimum",
      minimum_step: "写一句标题",
    }).minimum_step,
    "写一句标题",
  );
  for (const b of [
    { ...base, action: "mode", mode: "minimum", minimum_step: " " },
    { ...base, action: "mode", mode: "rest", minimum_step: "x" },
    { ...base, action: "attempt", confirmed: false },
    { ...base, action: "attempt", confirmed: true, complete: true },
  ])
    assert.throws(() => validateRhythmCommand(b));
});
