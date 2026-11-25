import assert from "node:assert/strict";
import test from "node:test";
import { validatePlanningFramework } from "../../src/modules/lighttick/planning/planning-framework.ts";

const period = { periodStart: "2026-11-23", periodEnd: "2026-11-29" };
const bounded = { title: "基线练习", outcome_criteria: "保留一份 60 秒原稿", starts_on: "2026-11-23", ends_on: "2026-11-24" };
const undated = { title: "换场景复测", outcome_criteria: "用新材料讲清结论", starts_on: null, ends_on: null };
const suggestion = { rationale: "先留原稿，再对照不同场景。", stages: [bounded, undated], missing_materials: ["一份新的工作案例"] };

test("a framework preserves an undated future stage and its material gap", () => {
  assert.deepEqual(validatePlanningFramework(suggestion, period), suggestion);
});

test("proposed dates may use the known goal horizon but never exceed it", () => {
  const later = { ...undated, starts_on: "2026-12-02", ends_on: "2026-12-05" };
  const value = { ...suggestion, stages: [bounded, later] };
  assert.throws(() => validatePlanningFramework(value, period));
  assert.throws(() => validatePlanningFramework(value, { ...period, targetDate: "2026-12-04" }));
  assert.deepEqual(validatePlanningFramework(value, { ...period, targetDate: "2026-12-05" }).stages, [bounded, later]);
});

test("incomplete dates, repeated stages, extra fields and unordered dates are rejected", () => {
  for (const stages of [
    [{ ...bounded, ends_on: null }],
    [bounded, { ...undated, title: bounded.title }],
    [{ ...undated, unexpected: true }],
    [{ ...bounded, starts_on: "2026-11-26", ends_on: "2026-11-27" }, bounded],
  ]) {
    assert.throws(() => validatePlanningFramework({ ...suggestion, stages }, period));
  }
});
