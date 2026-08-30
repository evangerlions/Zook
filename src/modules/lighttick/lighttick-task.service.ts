import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickOwner, LightTickTaskRow, LightTickTaskStepRow, LightTickTaskVariant } from "./lighttick.types.ts";
import type { LightTickTaskStatus } from "./lighttick-state-machines.ts";
import { transitionTask } from "./lighttick-state-machines.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";

export type LightTickTaskCommand =
  | { action: "start" }
  | { action: "complete"; actualMinutes?: number; notes?: string }
  | { action: "skip"; reason: "blocked" | "not_relevant" | "too_hard" | "no_time" | "other"; notes?: string }
  | { action: "defer"; scheduledFor: string; notes?: string }
  | { action: "cancel"; notes?: string };

export class LightTickTaskService {
  constructor(private readonly repository: LightTickRepository, private readonly clock = () => new Date()) {}

  async command(owner: LightTickOwner, taskId: string, baseVersion: number, command: LightTickTaskCommand): Promise<LightTickTaskRow> {
    const current = await this.repository.getTask(owner, taskId);
    if (!current) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Task was not found.");
    const target: Record<LightTickTaskCommand["action"], LightTickTaskStatus> = {
      start: "in_progress", complete: "completed", skip: "skipped", defer: "deferred", cancel: "cancelled",
    };
    const status = transitionTask(current.status as LightTickTaskStatus, target[command.action]);
    const timestamp = this.clock().toISOString(); const notes = "notes" in command ? command.notes?.trim() || current.notes : current.notes;
    if (command.action === "complete" && command.actualMinutes !== undefined &&
      (!Number.isInteger(command.actualMinutes) || command.actualMinutes < 1 || command.actualMinutes > 1440)) {
      throw new ApplicationError(400, "REQ_INVALID_BODY", "Actual duration is invalid.");
    }
    if (command.action === "defer" && Number.isNaN(Date.parse(command.scheduledFor))) {
      throw new ApplicationError(400, "REQ_INVALID_BODY", "Deferred schedule is invalid.");
    }
    const selectedVariant = current.selectedVariant ?? "standard";
    const next: LightTickTaskRow = { ...current, status, notes,
      scheduledFor: command.action === "defer" ? new Date(command.scheduledFor).toISOString() : current.scheduledFor,
      startedAt: command.action === "start" ? timestamp : current.startedAt,
      completedAt: command.action === "complete" ? timestamp : current.completedAt,
      actualMinutes: command.action === "complete" ? command.actualMinutes : current.actualMinutes,
      commitmentSatisfied: command.action === "complete" ? selectedVariant === "standard" : current.commitmentSatisfied,
      updatedAt: timestamp };
    const payload: Record<string, unknown> = { action: command.action, client_base_version: baseVersion };
    if (command.action === "complete") {
      payload.actual_minutes = command.actualMinutes;
      payload.selected_variant = selectedVariant;
      payload.valid_action = true;
      payload.commitment_satisfied = selectedVariant === "standard";
    }
    if (command.action === "skip") payload.reason = command.reason;
    if (command.action === "defer") payload.scheduled_for = next.scheduledFor;
    if (notes) payload.notes = notes;
    const goal = command.action === "complete" ? await this.repository.getGoal(owner, current.goalId) : undefined;
    const pausedAt = goal?.pauseMetadata?.pausedAt ? Date.parse(goal.pauseMetadata.pausedAt) : Number.NaN;
    const recoveryAt = goal?.recoveryStartedAt ? Date.parse(goal.recoveryStartedAt) : Number.NaN;
    const effectiveReturn = command.action === "complete" && goal?.status === "recovering" &&
      Number.isFinite(pausedAt) && Date.parse(timestamp) - pausedAt >= 3 * 86_400_000 &&
      Number.isFinite(recoveryAt) && Date.parse(timestamp) - recoveryAt <= 7 * 86_400_000;
    return await this.repository.saveTask(next, {
      event: { ...owner, id: randomId("lighttick_event"), aggregateType: "task", aggregateId: taskId,
        eventType: `task_${command.action}`, aggregateVersion: baseVersion + 1, payload, occurredAt: timestamp, createdAt: timestamp },
      additionalEvents: effectiveReturn ? [{ ...owner, id: randomId("lighttick_event"), aggregateType: "goal",
        aggregateId: current.goalId, eventType: "effective_return", aggregateVersion: goal!.version,
        payload: { task_id: taskId, interruption_days: Math.floor((Date.parse(timestamp) - pausedAt) / 86_400_000) },
        occurredAt: timestamp, createdAt: timestamp }] : undefined,
      change: { ...owner, entityType: "task", entityId: taskId, entityVersion: baseVersion + 1,
        operation: "upsert", snapshot: { id: taskId, status, scheduled_for: next.scheduledFor,
          version: baseVersion + 1 }, changedAt: timestamp },
    }, baseVersion);
  }

  async switchVariant(owner: LightTickOwner, taskId: string, baseVersion: number,
    variant: LightTickTaskVariant): Promise<LightTickTaskRow> {
    if (!["standard", "light", "minimum"].includes(variant))
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "Task variant is invalid.");
    const current = await this.repository.getTask(owner, taskId);
    if (!current) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Task was not found.");
    if (!["pending", "in_progress"].includes(current.status))
      throw new ApplicationError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "Completed or terminal tasks cannot change variant.");
    const definitions = current.variantDefinitions;
    const definition = definitions?.[variant];
    if (!definitions || !definition || !definitions.standard || !definitions.light || !definitions.minimum)
      throw new ApplicationError(400, "REQ_INVALID_BODY", "Task must define standard, light, and minimum variants.");
    const timestamp = this.clock().toISOString();
    const next: LightTickTaskRow = { ...current, lineageId: current.lineageId ?? current.id,
      selectedVariant: variant, title: definition.title, estimatedMinutes: definition.estimatedMinutes,
      completionCriteria: definition.completionCriteria, updatedAt: timestamp };
    return await this.repository.saveTask(next, {
      event: { ...owner, id: randomId("lighttick_event"), aggregateType: "task", aggregateId: taskId,
        eventType: "task_variant_changed", aggregateVersion: baseVersion + 1,
        payload: { lineage_id: next.lineageId, from: current.selectedVariant ?? "standard", to: variant },
        occurredAt: timestamp, createdAt: timestamp },
      change: { ...owner, entityType: "task", entityId: taskId, entityVersion: baseVersion + 1,
        operation: "upsert", snapshot: { id: taskId, lineage_id: next.lineageId, selected_variant: variant,
          estimated_duration_minutes: next.estimatedMinutes, version: baseVersion + 1 }, changedAt: timestamp },
    }, baseVersion);
  }

  async setStepCompletion(owner: LightTickOwner, taskId: string, stepId: string, baseVersion: number,
    completed: boolean): Promise<{ task: LightTickTaskRow; steps: LightTickTaskStepRow[] }> {
    return await this.repository.transaction(owner, async () => {
      const current = await this.repository.getTask(owner, taskId);
      if (!current) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Task was not found.");
      const step = await this.repository.getTaskStep(owner, taskId, stepId);
      if (!step) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Task step was not found.");
      const timestamp = this.clock().toISOString();
      const savedTask = await this.repository.saveTask({ ...current, updatedAt: timestamp }, {
        event: { ...owner, id: randomId("lighttick_event"), aggregateType: "task", aggregateId: taskId,
          eventType: "task_step_updated", aggregateVersion: baseVersion + 1,
          payload: { step_id: stepId, completed, client_base_version: baseVersion },
          occurredAt: timestamp, createdAt: timestamp },
        change: { ...owner, entityType: "task", entityId: taskId, entityVersion: baseVersion + 1,
          operation: "upsert", snapshot: { id: taskId, step_id: stepId, step_completed: completed,
            version: baseVersion + 1 }, changedAt: timestamp },
      }, baseVersion);
      if (step.completed !== completed) {
        await this.repository.saveTaskStep({ ...step, completed, updatedAt: timestamp }, step.version);
      }
      return { task: savedTask, steps: await this.repository.listTaskSteps(owner, taskId) };
    });
  }
}
