import { ApplicationError } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";
import { assertScheduledCapacity } from "./goal-context/confirmed-conditions.ts";
import type { LightTickRepository } from "./lighttick.repository.ts";
import { taskExecutionProgressData, taskRemainingEstimate } from "./lighttick-task-progress.ts";
import { businessDateAt } from "./lighttick-today.service.ts";
import type { LightTickGoalRow, LightTickTaskRow } from "./lighttick.types.ts";

export type TaskProgressCommand =
  | { action: "record_partial"; outcome: string; remainingWork?: string; actualMinutes?: number; estimate?: number | null }
  | { action: "set_remaining"; estimate: number | null }
  | { action: "wait"; reason: string; checkDate?: string }
  | { action: "resume" }
  | { action: "split"; title: string; date: string; estimate: number };

function invalid(field: string): never {
  throw new ApplicationError(400, "REQ_FIELD_INVALID", `${field} is invalid.`);
}

function conflict(message: string): never {
  throw new ApplicationError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", message);
}

function requiredText(value: unknown, field: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.length > max) invalid(field);
  return value.trim();
}

function optionalText(value: unknown, field: string, max: number) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > max) invalid(field);
  return value.trim() || undefined;
}

function minutes(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 1440) invalid(field);
  return value;
}

export function taskPlanningDate(value: unknown, field: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(field);
  const parsed = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid(field);
  return value;
}

export function taskProgressCommandOf(body: Record<string, unknown>): TaskProgressCommand {
  const rejectExtras = (fields: string[]) => {
    if (Object.keys(body).some(key => !["action", "base_version", ...fields].includes(key))) invalid("progress body");
  };
  const estimate = () => body.remaining_estimated_minutes === null ? null
    : minutes(body.remaining_estimated_minutes, "remaining_estimated_minutes");
  switch (body.action) {
    case "record_partial":
      rejectExtras(["outcome", "remaining_work", "actual_minutes", "remaining_estimated_minutes"]);
      return {
        action: body.action, outcome: requiredText(body.outcome, "outcome", 1000),
        remainingWork: optionalText(body.remaining_work, "remaining_work", 1000),
        actualMinutes: body.actual_minutes === undefined ? undefined : minutes(body.actual_minutes, "actual_minutes"),
        estimate: body.remaining_estimated_minutes === undefined ? undefined : estimate(),
      };
    case "set_remaining":
      rejectExtras(["remaining_estimated_minutes"]);
      return { action: body.action, estimate: estimate() };
    case "wait":
      rejectExtras(["reason", "check_date"]);
      return {
        action: body.action, reason: requiredText(body.reason, "reason", 500),
        checkDate: body.check_date === undefined ? undefined : taskPlanningDate(body.check_date, "check_date"),
      };
    case "resume":
      rejectExtras([]);
      return { action: body.action };
    case "split":
      rejectExtras(["title", "scheduled_for", "remaining_estimated_minutes"]);
      return {
        action: body.action, title: requiredText(body.title, "title", 160),
        date: taskPlanningDate(body.scheduled_for, "scheduled_for"),
        estimate: minutes(body.remaining_estimated_minutes, "remaining_estimated_minutes"),
      };
    default:
      return invalid("action");
  }
}

export function cumulativeTaskMinutes(previous: number | undefined, additional: number | undefined) {
  if (additional === undefined) return previous;
  return minutes((previous ?? 0) + additional, "cumulative actual duration");
}

const eventFor: Record<TaskProgressCommand["action"], string> = {
  record_partial: "task_partial_completed",
  set_remaining: "task_remaining_estimated",
  wait: "task_waiting",
  resume: "task_resumed",
  split: "task_remaining_transferred",
};

function writeProgress(task: LightTickTaskRow, eventType: string, timestamp: string, version: number,
  payload: Record<string, unknown> = {}) {
  const { appId, userId, id } = task;
  const progress = taskExecutionProgressData(task.executionProgress);
  return {
    event: { appId, userId, id: randomId("lighttick_event"), aggregateType: "task", aggregateId: id,
      eventType, aggregateVersion: version, payload: { ...progress, title: task.title, scheduled_for: task.scheduledFor,
        lineage_id: task.lineageId ?? id, cumulative_actual_minutes: task.actualMinutes, ...payload },
      occurredAt: timestamp, createdAt: timestamp },
    change: { appId, userId, entityType: "task", entityId: id, entityVersion: version,
      operation: "upsert" as const, snapshot: { id, version, status: task.status, scheduled_for: task.scheduledFor,
        actual_duration_minutes: task.actualMinutes, execution_progress: progress }, changedAt: timestamp },
  };
}

export async function runTaskProgressCommand(repository: LightTickRepository, current: LightTickTaskRow,
  goal: LightTickGoalRow | undefined, baseVersion: number, command: TaskProgressCommand, now: Date):
  Promise<{ task: LightTickTaskRow; remainingTask?: LightTickTaskRow }> {
  if (baseVersion !== current.version) throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Task version is stale.");
  if (current.lessonSource || !["pending", "in_progress"].includes(current.status))
    conflict("Only open ordinary actions can record progress.");
  const plan = await repository.getPlan(current, current.planId);
  if (!goal || plan?.status !== "active") conflict("Progress requires an active plan.");
  const timezone = (await repository.getProfile(current))?.timezone ?? "UTC";
  const today = businessDateAt(now, timezone);
  const timestamp = now.toISOString();
  const existing = current.executionProgress;
  const progress = { ...existing };
  const next: LightTickTaskRow = { ...current, executionProgress: progress, updatedAt: timestamp };
  if (progress.waiting && ["record_partial", "split"].includes(command.action)) conflict("Resume the task before doing more work.");

  if (command.action === "split") {
    if (!progress.outcome) conflict("Save what you already did before transferring the remaining work.");
    if (command.date < today || command.date < plan.periodStart.slice(0, 10) || command.date > plan.periodEnd.slice(0, 10))
      throw new ApplicationError(409, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "Choose a date from today within this plan.");
    const remaining: LightTickTaskRow = {
      appId: current.appId, userId: current.userId, id: randomId("lighttick_task"), planId: current.planId, goalId: current.goalId,
      title: command.title, priority: current.priority, status: "pending", estimatedMinutes: command.estimate,
      scheduledFor: command.date, executionProgress: { splitFromTaskId: current.id },
      version: 1, createdAt: timestamp, updatedAt: timestamp,
    };
    assertScheduledCapacity(goal, [remaining], await repository.listTasks(current), new Set([current.id]), timezone);
    next.status = "cancelled";
    progress.transferredToTaskId = remaining.id;
    const task = await repository.saveTask(next, writeProgress(next, eventFor.split, timestamp, baseVersion + 1), baseVersion);
    const remainingTask = await repository.saveTask(remaining, writeProgress(remaining, "task_remaining_created", timestamp, 1));
    return { task, remainingTask };
  }

  switch (command.action) {
    case "record_partial":
      next.status = "in_progress";
      next.startedAt ??= timestamp;
      next.actualMinutes = cumulativeTaskMinutes(current.actualMinutes, command.actualMinutes);
      progress.outcome = command.outcome;
      if (command.remainingWork !== undefined) progress.remainingWork = command.remainingWork;
      progress.remainingEstimatedMinutes = command.estimate === undefined
        ? existing?.remainingEstimatedMinutes ?? null : command.estimate;
      break;
    case "set_remaining":
      progress.remainingEstimatedMinutes = command.estimate;
      break;
    case "wait":
      if (command.checkDate && command.checkDate < today) invalid("check_date");
      progress.waiting = { reason: command.reason, ...(command.checkDate ? { checkDate: command.checkDate } : {}) };
      break;
    case "resume":
      if (!progress.waiting) conflict("The task is not waiting for an external input.");
      delete progress.waiting;
      progress.remainingEstimatedMinutes ??= existing?.remainingEstimatedMinutes === null ? null : current.estimatedMinutes;
      break;
  }

  const previousEstimate = taskRemainingEstimate(current);
  const nextEstimate = taskRemainingEstimate(next);
  const addsToSchedule = nextEstimate !== undefined &&
    (command.action === "resume" || previousEstimate === undefined || nextEstimate > previousEstimate);
  if (!progress.waiting && next.scheduledFor && addsToSchedule) {
    const date = next.scheduledFor.length === 10 ? next.scheduledFor : businessDateAt(new Date(next.scheduledFor), timezone);
    if (date >= today) {
      assertScheduledCapacity(goal, [{ ...next, estimatedMinutes: nextEstimate }],
        await repository.listTasks(current), new Set([next.id]), timezone);
    }
  }
  const details = command.action === "record_partial" ? { actual_minutes: command.actualMinutes }
    : command.action === "resume" && existing?.waiting ? { previous_waiting_reason: existing.waiting.reason } : {};
  return { task: await repository.saveTask(next, writeProgress(next, eventFor[command.action], timestamp, baseVersion + 1, details), baseVersion) };
}
