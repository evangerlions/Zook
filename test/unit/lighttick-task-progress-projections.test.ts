import assert from "node:assert/strict";
import test from "node:test";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickProfileService } from "../../src/modules/lighttick/lighttick-profile.service.ts";
import { LightTickReviewService } from "../../src/modules/lighttick/lighttick-review.service.ts";
import { LightTickRhythmWeeklyService } from "../../src/modules/lighttick/lighttick-rhythm-weekly.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import { manualTaskData } from "../../src/modules/lighttick/manual/manual-planning.service.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";

test("partial and waiting tasks retain facts across Today, planning, review and the business-day boundary", async () => {
  const owner = { appId: "lighttick", userId: "alice" } as const;
  const repository = new InMemoryLightTickRepository();
  let instant = new Date("2026-11-23T15:55:00Z");
  const clock = () => instant;
  const { goal } = await new LightTickProfileService(repository, clock).submitOnboarding(owner, {
    title: "Prepare a report", currentLevel: "Ready", weeklyAvailableMinutes: 300, pace: "balanced", timezone: "Asia/Shanghai",
  });
  const planService = new LightTickPlanService(repository, clock);
  const proposal = await planService.createProposed(owner, {
    goalId: goal.id, source: "template", granularity: "week", periodStart: "2026-11-23", periodEnd: "2026-11-29",
    tasks: [
      { title: "Review figures", estimatedMinutes: 40, scheduledFor: "2026-11-23" },
      { title: "Confirm delivery dates", estimatedMinutes: 15, scheduledFor: "2026-11-23" },
      { title: "Practice the opening", estimatedMinutes: 20, scheduledFor: "2026-11-24" },
    ],
  });
  const { tasks: [first, external] } = await planService.confirm(owner, proposal.id, proposal.version);
  const taskService = new LightTickTaskService(repository, clock);
  const today = new LightTickTodayService(repository, clock);
  const partial = (await taskService.progress(owner, first.id, first.version, {
    action: "record_partial", outcome: "Private progress", remainingWork: "Private remaining work", actualMinutes: 7,
  })).task;
  const waiting = (await taskService.progress(owner, external.id, external.version, {
    action: "wait", reason: "Private dependency", checkDate: "2026-11-24",
  })).task;

  const planTask = manualTaskData(partial, "Asia/Shanghai");
  assert.equal(planTask.estimated_duration_minutes, 40);
  assert.equal(planTask.actual_duration_minutes, 7);
  assert.equal(planTask.execution_progress?.remaining_estimated_minutes, null);
  let snapshot = await today.get(owner);
  assert.deepEqual(snapshot.executableTasks.map(task => task.id), [first.id]);
  assert.equal(snapshot.remainingEstimatedMinutes, 0);
  assert.equal(snapshot.unknownRemainingTaskCount, 1);
  assert.deepEqual(snapshot.waitingTasks.map(task => task.id), [external.id]);
  assert.equal(snapshot.waitingTasks[0].executionProgress?.waiting?.checkDate, "2026-11-24");

  const review = await new LightTickReviewService(repository, clock).create(owner, goal.id, "day", "2026-11-23", "2026-11-23");
  assert.equal(review.dataSufficiency, "insufficient");
  assert.deepEqual(review.facts.event_counts, { task_partial_completed: 1, task_waiting: 1 });
  assert.match(JSON.stringify(review.facts.tasks), /"actual_minutes":7/);
  assert.doesNotMatch(JSON.stringify(review.facts), /Private/);
  const week = await new LightTickRhythmWeeklyService(repository, clock).get(owner, "2026-11-23");
  assert.equal(week.stats.task_pending_count, 2);
  assert.equal(week.stats.task_completed_count, 0);
  assert.equal(week.tasks.find(task => task.id === waiting.id)?.execution_progress?.waiting?.check_date, "2026-11-24");

  instant = new Date("2026-11-23T16:05:00Z");
  snapshot = await today.get(owner);
  assert.equal(snapshot.businessDate, "2026-11-24");
  assert.deepEqual(snapshot.continuationTasks.map(task => task.id), [first.id]);
  assert.deepEqual(snapshot.waitingTasks.map(task => task.id), [external.id]);
  assert.equal(snapshot.remainingEstimatedMinutes, 20);
  await taskService.progress(owner, waiting.id, waiting.version, { action: "resume" });
  snapshot = await today.get(owner);
  assert.deepEqual(snapshot.continuationTasks.map(task => task.id), [first.id, external.id]);
  assert.deepEqual(snapshot.waitingTasks, []);

  const split = await taskService.progress(owner, partial.id, partial.version, {
    action: "split", title: "Finish checking figures", date: "2026-11-24", estimate: 12,
  });
  assert.equal(split.task.actualMinutes, 7);
  assert.equal(split.task.executionProgress?.transferredToTaskId, split.remainingTask?.id);
  snapshot = await today.get(owner);
  assert.deepEqual(snapshot.continuationTasks.map(task => task.id), [external.id]);
  assert.ok(snapshot.executableTasks.some(task => task.executionProgress?.splitFromTaskId === first.id));
  assert.equal(snapshot.remainingEstimatedMinutes, 32);
});
