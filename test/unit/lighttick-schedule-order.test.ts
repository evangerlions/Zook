import assert from "node:assert/strict";
import test from "node:test";
import { assertLessonOrder } from "../../src/modules/lighttick/learning/learning-schedule-capacity.ts";

const at = (day: string, hour = 9) => `2026-12-${day}T0${hour}:00:00.000Z`;

test("同一门课的课节必须按蓝图顺序排期", () => {
  assert.doesNotThrow(() => assertLessonOrder([
    { lesson_number: 1, scheduled_for: at("01") },
    { lesson_number: 2, scheduled_for: at("03") },
    { lesson_number: 3, scheduled_for: at("05") },
  ]));
  // 同一天先学后练是正常排法
  assert.doesNotThrow(() => assertLessonOrder([
    { lesson_number: 1, scheduled_for: at("01") },
    { lesson_number: 2, scheduled_for: at("01", 14) },
  ]));
  // 后面的课被排到更早的日期 → 拒
  assert.throws(() => assertLessonOrder([
    { lesson_number: 1, scheduled_for: at("05") },
    { lesson_number: 2, scheduled_for: at("03") },
  ]), { statusCode: 422 });
  // 同号的两条（learn / practice）按最早那条比较，不算逆序
  assert.doesNotThrow(() => assertLessonOrder([
    { lesson_number: 1, scheduled_for: at("01") },
    { lesson_number: 1, scheduled_for: at("02") },
    { lesson_number: 2, scheduled_for: at("03") },
  ]));
});
