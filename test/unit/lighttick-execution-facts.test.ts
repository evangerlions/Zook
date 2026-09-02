import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateExecutionFacts, buildSingleCompletionFeedback, evaluateFeedbackRules,
} from "../../src/modules/lighttick/lighttick-execution-facts.ts";
import type { LightTickExecutionEventRow } from "../../src/modules/lighttick/lighttick.types.ts";

const OWNER = { appId: "lighttick" as const, userId: "user-1" };
const TIMEZONE = "Asia/Shanghai";

function completionEvent(overrides: Partial<LightTickExecutionEventRow> & { occurredAt: string; payload: Record<string, unknown> }): LightTickExecutionEventRow {
  return { id: `evt-${overrides.occurredAt}`, ...OWNER, aggregateType: "task", aggregateId: "task-1",
    eventType: "task_completed", aggregateVersion: 1, createdAt: overrides.occurredAt, ...overrides };
}

test("single completion only produces factual output with no stable inference", () => {
  const events = [completionEvent({ occurredAt: "2026-09-01T02:10:00Z", payload: {
    action: "complete", actual_minutes: 14, estimated_minutes: 12, valid_action: true,
    title: "完成10道PMP诊断题", lineage_id: "lineage-1" } })];
  const facts = aggregateExecutionFacts(events, TIMEZONE);
  assert.equal(facts.completedCount, 1);
  assert.equal(facts.averageDeviationMinutes, 2);
  const feedback = evaluateFeedbackRules(facts);
  assert.equal(feedback.length, 1);
  assert.equal(feedback[0]!.kind, "factual");
  assert.equal(feedback[0]!.confident, false);
  assert.match(feedback[0]!.message, /预计 12 分钟，实际用了 14 分钟/);
});

test("three same-lineage completions yield a low-confidence estimation hypothesis", () => {
  const events = ["2026-09-01T02:00:00Z", "2026-09-02T02:10:00Z", "2026-09-03T02:20:00Z"].map((occurredAt, index) =>
    completionEvent({ occurredAt, payload: { action: "complete", actual_minutes: 30 + index * 10,
      estimated_minutes: 20, valid_action: true, title: "练习", lineage_id: "lineage-1" } }));
  const facts = aggregateExecutionFacts(events, TIMEZONE);
  const feedback = evaluateFeedbackRules(facts);
  const bias = feedback.find(item => item.ruleId === "hypothesis.time_estimation_bias");
  assert.ok(bias);
  assert.equal(bias.kind, "hypothesis");
  assert.equal(bias.confident, false);
  assert.equal(bias.evidenceCount, 3);
});

test("stable rule requires at least seven events and a stable ratio", () => {
  const events = Array.from({ length: 7 }, (_, index) => completionEvent({
    occurredAt: `2026-09-0${index + 1}T02:00:00Z`,
    payload: { action: "complete", actual_minutes: 15, estimated_minutes: 14, valid_action: true,
      title: "晨读", lineage_id: "lineage-1" } }));
  const facts = aggregateExecutionFacts(events, TIMEZONE);
  const feedback = evaluateFeedbackRules(facts);
  const rule = feedback.find(item => item.ruleId === "rule.time_estimation_bias");
  assert.ok(rule);
  assert.equal(rule.kind, "rule");
  assert.equal(rule.confident, true);
  assert.equal(rule.evidenceCount, 7);
});

test("completion slot uses the user timezone, not UTC", () => {
  const events = [completionEvent({ occurredAt: "2026-09-01T02:10:00Z", payload: {
    action: "complete", actual_minutes: 10, estimated_minutes: 10, valid_action: true, title: "任务", lineage_id: "l1" } })];
  const shanghai = aggregateExecutionFacts(events, "Asia/Shanghai");
  const utc = aggregateExecutionFacts(events, "UTC");
  assert.ok(shanghai.bySlot[10]);
  assert.ok(!shanghai.bySlot[2]);
  assert.ok(utc.bySlot[2]);
});

test("consecutive skips within seven days are grouped per lineage", () => {
  const events = [
    completionEvent({ occurredAt: "2026-09-01T02:00:00Z", eventType: "task_skipped", payload: {
      action: "skip", reason: "no_time", title: "背单词", lineage_id: "l-skip" } }),
    completionEvent({ occurredAt: "2026-09-03T02:00:00Z", eventType: "task_skipped", payload: {
      action: "skip", reason: "no_time", title: "背单词", lineage_id: "l-skip" } }),
  ];
  const facts = aggregateExecutionFacts(events, TIMEZONE);
  assert.equal(facts.maxConsecutiveSkipsByLineage["l-skip"]?.count, 2);
  const feedback = evaluateFeedbackRules(facts);
  assert.ok(feedback.some(item => item.ruleId === "hypothesis.consecutive_skips"));
});

test("single completion feedback builder never claims stability", () => {
  const feedback = buildSingleCompletionFeedback(
    { id: "task-1", title: "晨跑", estimatedMinutes: 20, selectedVariant: "standard" }, 32, "2026-09-01T00:00:00Z");
  assert.equal(feedback.kind, "factual");
  assert.equal(feedback.confident, false);
  assert.equal(feedback.evidenceCount, 1);
  assert.match(feedback.message, /预计 20 分钟，实际用了 32 分钟/);
});

test("invalid or non-completion events are excluded from aggregation", () => {
  const events = [
    completionEvent({ occurredAt: "2026-09-01T02:10:00Z", payload: {
      action: "complete", actual_minutes: 10, estimated_minutes: 10, title: "任务", lineage_id: "l1" } }),
    completionEvent({ occurredAt: "2026-09-02T02:10:00Z", payload: {
      action: "start", title: "任务", lineage_id: "l1" } }),
  ];
  const facts = aggregateExecutionFacts(events, TIMEZONE);
  assert.equal(facts.completedCount, 1);
});
