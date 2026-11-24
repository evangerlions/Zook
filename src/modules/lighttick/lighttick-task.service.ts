import { businessDateAt, isMissedOrdinaryTask, taskScheduledDate, todayDateAt } from "./lighttick-today.service.ts";
import { assertLearningCapacity, type LearningScheduleBudget } from "./learning/learning-schedule-capacity.ts";
import { assertScheduledCapacity } from "./goal-context/confirmed-conditions.ts";
import { resolveGoalConditions } from "./goal-context/resolve-conditions.ts";
import { assertWeeklyPlanningCapacity } from "./planning/weekly-capacity.ts";
import { assertTaskPrerequisiteSatisfied, readTaskPrerequisite } from "./planning/task-prerequisite.ts";
import { assertOrdinaryTaskDateRange } from "./planning/roadmap-placement.ts";
import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickOwner, LightTickTaskRow, LightTickTaskStepRow, LightTickTaskVariant } from "./lighttick.types.ts";
import type { LightTickTaskStatus } from "./lighttick-state-machines.ts";
import { transitionTask } from "./lighttick-state-machines.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";
import { taskAwaitingExternalInput, taskExecutionProgressData, taskRemainingEstimate } from "./lighttick-task-progress.ts";
import { cumulativeTaskMinutes, runTaskProgressCommand, taskPlanningDate, type TaskProgressCommand } from "./lighttick-task-progress-command.ts";

export type LightTickTaskCommand =
  | { action: "start" }
  | { action: "complete"; actualMinutes?: number; actualMinutesIncremental?: boolean; difficulty?: "low" | "medium" | "high"; notes?: string;
      learningCompletion?: { contentVersion: string; baseRevision: number } }
  | { action: "skip"; reason: "blocked" | "not_relevant" | "too_hard" | "no_time" | "other"; notes?: string }
  | { action: "reschedule"; date: string; source?: "learning_continuation" }
  | { action: "defer"; scheduledFor: string; notes?: string }
  | { action: "cancel"; notes?: string };

export class LightTickTaskService {
  /**
   * M8 combined completion collaborator: marks the referenced lesson learned via
   * the authoritative private-learning command inside the SAME owner transaction.
   * Wired by the runtime; absent when learning writes are unavailable.
   */
  completeLesson?: (owner: LightTickOwner, lessonId: string, contentVersion: string, baseRevision: number, key: string) => Promise<unknown>;
  constructor(private readonly repository: LightTickRepository, private readonly clock = () => new Date()) {}

  async progress(owner: LightTickOwner, taskId: string, baseVersion: number, command: TaskProgressCommand) {
    return this.repository.transaction(owner, async () => {
      await this.repository.lockPlanningOwner(owner);
      const current = await this.repository.getTask(owner, taskId);
      if (!current) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Task was not found.");
      const goal = await this.assertGoalAllowsExecution(owner, current);
      return await runTaskProgressCommand(this.repository, current, goal, baseVersion, command, this.clock());
    });
  }

  async command(owner: LightTickOwner, taskId: string, baseVersion: number, command: LightTickTaskCommand): Promise<LightTickTaskRow> {
    return this.repository.transaction(owner, async () => {
      await this.repository.lockPlanningOwner(owner);
      return this.executeCommand(owner, taskId, baseVersion, command);
    });
  }

  private async executeCommand(owner: LightTickOwner, taskId: string, baseVersion: number, command: LightTickTaskCommand): Promise<LightTickTaskRow> {
    const current = await this.repository.getTask(owner, taskId);
    const activeGoal = current && await this.assertGoalAllowsExecution(owner, current);
    if (!current) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Task was not found.");
    if (current.prerequisiteTaskId && (command.action === "start" || command.action === "complete")) {
      if (baseVersion !== current.version) throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Task version is stale.");
      await assertTaskPrerequisiteSatisfied(this.repository, owner, current);
    }
    if (taskAwaitingExternalInput(current) && command.action !== "cancel" && command.action !== "skip")
      throw new ApplicationError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "Resume the task before executing it.");
    const target: Record<Exclude<LightTickTaskCommand["action"], "reschedule">, LightTickTaskStatus> = {
      start: "in_progress", complete: "completed", skip: "skipped", defer: "deferred", cancel: "cancelled",
    };
    const now = this.clock();
    if (current.lessonSource && ["start", "complete", "reschedule", "defer"].includes(command.action)) {
      const route = await this.repository.learningRoutes.getLearningRoute(owner, current.lessonSource.route_id);
      if (route?.status !== "active")
        throw new ApplicationError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "Resume the course before executing its scheduled task.");
      if (command.action === "defer")
        command = { action: "reschedule", date: command.scheduledFor.slice(0, 10) };
    }
    if (current.executionProgress && command.action === "defer")
      command = { action: "reschedule", date: command.scheduledFor.slice(0, 10) };
    if (command.action === "reschedule") {
      const date = taskPlanningDate(command.date, "target_date");
      const { timezone, businessDate } = todayDateAt(now, (await this.repository.getProfile(owner))?.timezone ?? "UTC");
      const plan = await this.repository.getPlan(owner, current.planId);
      const originalDate = current.prerequisiteTaskId ? taskScheduledDate(current, timezone) : undefined;
      const isReadyLinkedContinuation = current.status === "in_progress" && !current.lessonSource && !!current.prerequisiteTaskId &&
        (!originalDate || originalDate < businessDate) &&
        (await readTaskPrerequisite(this.repository, owner, current))?.state === "complete";
      const continuing = current.status === "in_progress" && (current.lessonSource || current.executionProgress || isReadyLinkedContinuation ||
        (plan && activeGoal && isMissedOrdinaryTask(current, plan, activeGoal, businessDate, timezone)));
      if ((current.status !== "pending" && !continuing) || plan?.status !== "active")
        throw new ApplicationError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "Only open actions in an active plan can be rescheduled.");
      if (date < businessDate || date < plan.periodStart.slice(0, 10) || date > plan.periodEnd.slice(0, 10))
        throw new ApplicationError(409, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "Choose a date from today within this plan.");
      if (activeGoal && !current.lessonSource) assertOrdinaryTaskDateRange(activeGoal, plan, date);
      const estimate = taskRemainingEstimate(current);
      if (current.executionProgress && estimate === undefined)
        throw new ApplicationError(409, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "Estimate the remaining work before scheduling it.");
      if (activeGoal) {
        const tasks = await this.repository.listTasks(owner);
        const replacing = new Set([taskId]);
        if (current.lessonSource) {
          const budget = plan.proposal.learning_budget as unknown as LearningScheduleBudget;
          assertLearningCapacity(activeGoal, budget, [{ scheduled_for: date, estimated_minutes: current.estimatedMinutes }], tasks, timezone, replacing);
        } else {
          assertScheduledCapacity(activeGoal, [{ ...current, scheduledFor: date, estimatedMinutes: estimate ?? null }], tasks, replacing, timezone);
        }
        await assertWeeklyPlanningCapacity(this.repository, owner,
          [{ id: current.id, scheduledFor: date, estimatedMinutes: estimate ?? null }], { existing: tasks, replacing, timezone, now });
      }
    }
    const status = command.action === "reschedule" ? current.status : transitionTask(current.status as LightTickTaskStatus, target[command.action]);
    const timestamp = now.toISOString(); const notes = "notes" in command ? command.notes?.trim() || current.notes : current.notes;
    if (command.action === "complete" && command.actualMinutes !== undefined &&
      (!Number.isInteger(command.actualMinutes) || command.actualMinutes < 1 || command.actualMinutes > 1440)) {
      throw new ApplicationError(400, "REQ_INVALID_BODY", "Actual duration is invalid.");
    }
    if (command.action === "complete" && command.difficulty !== undefined &&
      !["low", "medium", "high"].includes(command.difficulty)) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "Task difficulty is invalid.");
    }
    if (command.action === "defer" && Number.isNaN(Date.parse(command.scheduledFor))) {
      throw new ApplicationError(400, "REQ_INVALID_BODY", "Deferred schedule is invalid.");
    }
    // M8 explicit combined completion: only a learn-purpose task with a fixed source
    // may confirm "lesson learned AND arrangement complete" in one atomic transaction.
    if (command.action === "complete" && command.learningCompletion !== undefined) {
      const lc = command.learningCompletion, lt = current.learningTarget;
      if (!lt || lt.purpose !== "learn")
        throw new ApplicationError(422, "REQ_FIELD_INVALID", "Only a learning task can confirm lesson completion.");
      if (typeof lc.contentVersion !== "string" || !/^[a-f0-9]{64}$/.test(lc.contentVersion) ||
        !Number.isInteger(lc.baseRevision) || lc.baseRevision < 0 || lc.baseRevision > 2147483647)
        throw new ApplicationError(400, "REQ_INVALID_BODY", "Learning completion reference is invalid.");
      if (lc.contentVersion !== lt.content_version)
        throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "The pinned lesson version changed. Review the current source.");
      if (!this.completeLesson)
        throw new ApplicationError(503, "LIGHTTICK_APP_DISABLED", "Learning completion is unavailable; the arrangement was not completed.");
    }
    let actualMinutes = current.actualMinutes;
    if (command.action === "complete") {
      if (command.actualMinutesIncremental) {
        actualMinutes = cumulativeTaskMinutes(current.actualMinutes, command.actualMinutes);
      } else if (command.actualMinutes !== undefined) {
        if (current.executionProgress && command.actualMinutes < (current.actualMinutes ?? 0))
          throw new ApplicationError(409, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "The total cannot be below the effort already recorded.");
        actualMinutes = command.actualMinutes;
      }
    }
    const executionProgress = current.executionProgress && taskAwaitingExternalInput(current) &&
      (command.action === "cancel" || command.action === "skip") ? { ...current.executionProgress, waiting: undefined } : current.executionProgress;
    const selectedVariant = current.selectedVariant ?? "standard";
    const next: LightTickTaskRow = { ...current, status, notes,
      scheduledFor: command.action === "reschedule" ? command.date
        : command.action === "defer" ? new Date(command.scheduledFor).toISOString() : current.scheduledFor,
      startedAt: command.action === "start" ? timestamp : current.startedAt,
      completedAt: command.action === "complete" ? timestamp : current.completedAt,
      actualMinutes, executionProgress,
      commitmentSatisfied: command.action === "complete" ? selectedVariant === "standard" : current.commitmentSatisfied,
      updatedAt: timestamp };
    const payload: Record<string, unknown> = { action: command.action, client_base_version: baseVersion };
    if (command.action === "complete") {
      payload.actual_minutes = actualMinutes;
      payload.difficulty = command.difficulty;
      payload.selected_variant = selectedVariant;
      payload.valid_action = true;
      payload.commitment_satisfied = selectedVariant === "standard";
      payload.estimated_minutes = current.estimatedMinutes;
      payload.title = current.title;
      payload.lineage_id = current.lineageId ?? current.id;
      payload.scheduled_for = current.scheduledFor ?? null;
    }
    if (command.action === "skip") payload.reason = command.reason;
    if (command.action === "defer" || command.action === "reschedule") payload.scheduled_for = next.scheduledFor;
    if (command.action === "reschedule" && command.source) {
      payload.source = command.source;
      payload.previous_scheduled_for = current.scheduledFor;
    }
    if (command.action === "skip") { payload.title = current.title; payload.lineage_id = current.lineageId ?? current.id; }
    if (notes) payload.notes = notes;
    if (command.action === "complete" && command.learningCompletion !== undefined) {
      const lt = current.learningTarget!;
      payload.learning_completion = { lesson_id: lt.lesson_id, content_version: lt.content_version,
        plan_id: lt.plan_id, lesson_no: lt.lesson_no };
    }
    const goal = command.action === "complete" ? await this.repository.getGoal(owner, current.goalId) : undefined;
    const pausedAt = goal?.pauseMetadata?.pausedAt ? Date.parse(goal.pauseMetadata.pausedAt) : Number.NaN;
    const recoveryAt = goal?.recoveryStartedAt ? Date.parse(goal.recoveryStartedAt) : Number.NaN;
    const effectiveReturn = command.action === "complete" && goal?.status === "recovering" &&
      Number.isFinite(pausedAt) && Date.parse(timestamp) - pausedAt >= 3 * 86_400_000 &&
      Number.isFinite(recoveryAt) && Date.parse(timestamp) - recoveryAt <= 7 * 86_400_000;
    const saved = await this.repository.saveTask(next, {
      event: { ...owner, id: randomId("lighttick_event"), aggregateType: "task", aggregateId: taskId,
        eventType: `task_${command.action}`, aggregateVersion: baseVersion + 1, payload, occurredAt: timestamp, createdAt: timestamp },
      additionalEvents: effectiveReturn ? [{ ...owner, id: randomId("lighttick_event"), aggregateType: "goal",
        aggregateId: current.goalId, eventType: "effective_return", aggregateVersion: goal!.version,
        payload: { task_id: taskId, interruption_days: Math.floor((Date.parse(timestamp) - pausedAt) / 86_400_000) },
        occurredAt: timestamp, createdAt: timestamp }] : undefined,
      change: { ...owner, entityType: "task", entityId: taskId, entityVersion: baseVersion + 1,
        operation: "upsert", snapshot: { id: taskId, status, scheduled_for: next.scheduledFor,
          ...(current.executionProgress ? { execution_progress: taskExecutionProgressData(executionProgress) ?? null, actual_duration_minutes: actualMinutes } : {}),
          version: baseVersion + 1 }, changedAt: timestamp },
    }, baseVersion);
    // Task is completed first; the lesson completion runs in the same owner transaction
    // so both facts commit atomically. The completion projection sees the task already
    // completed and skips it (idempotent), avoiding a double write or version conflict.
    if (command.action === "complete" && command.learningCompletion !== undefined) {
      const lt = current.learningTarget!;
      await this.completeLesson!(owner, lt.lesson_id, lt.content_version, command.learningCompletion.baseRevision,
        `combined-${taskId}-${baseVersion}`);
    }
    return saved;
  }

  async switchVariant(owner: LightTickOwner, taskId: string, baseVersion: number,
    variant: LightTickTaskVariant): Promise<LightTickTaskRow> {
    return this.repository.transaction(owner, async () => {
      await this.repository.lockPlanningOwner(owner);
      return this.executeVariant(owner, taskId, baseVersion, variant);
    });
  }
  private async executeVariant(owner: LightTickOwner, taskId: string, baseVersion: number, variant: LightTickTaskVariant): Promise<LightTickTaskRow> {
    if (!["standard", "light", "minimum"].includes(variant))
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "Task variant is invalid.");
    const current = await this.repository.getTask(owner, taskId);
    const goal = current ? await this.assertGoalAllowsExecution(owner, {...current,selectedVariant:variant}) : undefined;
    if (!current) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Task was not found.");
    if (!["pending", "in_progress"].includes(current.status))
      throw new ApplicationError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "Completed or terminal tasks cannot change variant.");
    if (current.executionProgress)
      throw new ApplicationError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "Keep the original task variant after recording progress.");
    const definitions = current.variantDefinitions;
    const definition = definitions?.[variant];
    if (!definitions || !definition || !definitions.standard || !definitions.light || !definitions.minimum)
      throw new ApplicationError(400, "REQ_INVALID_BODY", "Task must define standard, light, and minimum variants.");
    const timestamp = this.clock().toISOString();
    const next: LightTickTaskRow = { ...current, lineageId: current.lineageId ?? current.id,
      selectedVariant: variant, title: definition.title, estimatedMinutes: definition.estimatedMinutes,
      completionCriteria: definition.completionCriteria, updatedAt: timestamp };
    if (goal?.constraints.confirmed_planning_conditions !== undefined) assertScheduledCapacity(await resolveGoalConditions(this.repository,owner,goal),[next],await this.repository.listTasks(owner),new Set([taskId]),(await this.repository.getProfile(owner))?.timezone??"UTC");
    await assertWeeklyPlanningCapacity(this.repository, owner, [next], { replacing: new Set([taskId]) });
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
      await this.repository.lockPlanningOwner(owner);
      const current = await this.repository.getTask(owner, taskId);
      if (!current) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Task was not found.");
      await this.assertGoalAllowsExecution(owner, current);
      if (taskAwaitingExternalInput(current) || current.executionProgress?.transferredToTaskId)
        throw new ApplicationError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "This task is not currently available for execution.");
      if (completed && current.prerequisiteTaskId)
        await assertTaskPrerequisiteSatisfied(this.repository, owner, current);
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
  private async assertGoalAllowsExecution(owner: LightTickOwner, task: LightTickTaskRow) {
    const goal = await this.repository.getGoal(owner, task.goalId);
    // Historical orphan rows retain task-state rules; known goal states are authoritative.
    if (!goal) return;
    const variant = task.selectedVariant ?? "standard";
    const pausedAllowed = goal.status === "paused" && goal.pauseMetadata?.keepLightTasks === true && variant !== "standard";
    const needsReviewedRecovery = goal.status === "recovering" && variant === "standard" && ["manual_native", "local_adoption", "learning_schedule"].includes((await this.repository.getPlan(owner, task.planId))?.source ?? "");
    if (["completed", "archived"].includes(goal.status) || goal.status === "paused" && !pausedAllowed || needsReviewedRecovery)
      throw new ApplicationError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "The goal is stopped or requires reviewed resumption; cached task commands cannot resume it.");
    return goal;
  }

}
