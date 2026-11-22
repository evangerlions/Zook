import type { LightTickTaskExecutionProgress, LightTickTaskRow } from "./lighttick.types.ts";

type WithProgress = Pick<LightTickTaskRow, "executionProgress">;

export function taskRemainingEstimate(task: Pick<LightTickTaskRow, "estimatedMinutes" | "executionProgress">): number | undefined {
  const remaining = task.executionProgress?.remainingEstimatedMinutes;
  return (remaining === undefined ? task.estimatedMinutes : remaining) ?? undefined;
}

export function taskAwaitingExternalInput(task: WithProgress): boolean {
  return !!task.executionProgress?.waiting;
}

export function taskHasTransferredRemainingWork(task: WithProgress): boolean {
  return !!task.executionProgress?.transferredToTaskId;
}

export function taskExecutionProgressData(progress: LightTickTaskExecutionProgress | undefined) {
  if (!progress) return undefined;
  const { outcome, remainingWork, remainingEstimatedMinutes, waiting, transferredToTaskId, splitFromTaskId } = progress;
  const data = {
    ...(outcome !== undefined ? { outcome } : {}),
    ...(remainingWork !== undefined ? { remaining_work: remainingWork } : {}),
    ...(remainingEstimatedMinutes !== undefined ? { remaining_estimated_minutes: remainingEstimatedMinutes } : {}),
    ...(waiting ? { waiting: { reason: waiting.reason, ...(waiting.checkDate ? { check_date: waiting.checkDate } : {}) } } : {}),
    ...(transferredToTaskId ? { transferred_to_task_id: transferredToTaskId } : {}),
    ...(splitFromTaskId ? { split_from_task_id: splitFromTaskId } : {}),
  };
  return Object.keys(data).length ? data : undefined;
}

export function taskExecutionProgressFromStorage(partialOutcome: unknown, waiting: unknown): LightTickTaskExecutionProgress | undefined {
  const partial = objectOrEmpty(partialOutcome);
  const wait = objectOrEmpty(waiting);
  const outcome = text(partial.outcome) ?? text(partial.done);
  const remainingWork = text(partial.remaining_work) ?? text(partial.remaining);
  const remaining = partial.remaining_estimated_minutes;
  const reason = text(wait.reason);
  const checkDate = text(wait.check_date) ?? text(wait.check_on);
  const transferredToTaskId = text(partial.transferred_to_task_id);
  const splitFromTaskId = text(partial.split_from_task_id);
  const progress: LightTickTaskExecutionProgress = {
    ...(outcome === undefined ? {} : { outcome }),
    ...(remainingWork === undefined ? {} : { remainingWork }),
    ...(remaining === null || typeof remaining === "number" && Number.isInteger(remaining) && remaining >= 1 && remaining <= 1440
      ? { remainingEstimatedMinutes: remaining } : {}),
    ...(reason ? { waiting: { reason, ...(checkDate ? { checkDate } : {}) } } : {}),
    ...(transferredToTaskId ? { transferredToTaskId } : {}),
    ...(splitFromTaskId ? { splitFromTaskId } : {}),
  };
  return Object.keys(progress).length ? progress : undefined;
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
