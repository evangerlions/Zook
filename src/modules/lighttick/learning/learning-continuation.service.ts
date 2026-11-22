import { ApplicationError } from "../../../shared/errors.ts";
import { isWeeklyPlanningCapacityError } from "../planning/weekly-capacity.ts";
import type { LightTickNotificationService } from "../lighttick-notifications.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickTaskService } from "../lighttick-task.service.ts";
import { businessDateAt } from "../lighttick-today.service.ts";
import type { LightTickOwner, LightTickTaskRow } from "../lighttick.types.ts";
import { accountClock, nextBusinessDay, type LearningAdjustmentReason, type LearningContinuationRow } from "./learning-continuation.types.ts";
import { taskBusinessDate } from "./learning-schedule-capacity.ts";
import { LearningSchedulingService } from "./learning-scheduling.service.ts";
import type { NativeLearningService } from "./native-learning.service.ts";

type Delivery = Pick<LightTickNotificationService, "enqueue">;
interface Dependencies {
  repository: LightTickRepository;
  native: () => NativeLearningService;
  tasks: () => LightTickTaskService;
  authorizeOwner: (owner: LightTickOwner) => Promise<boolean>;
  available: () => Promise<boolean>;
  notifications: () => Delivery | undefined;
  notificationsEnabled?: () => Promise<boolean>;
  clock?: () => Date;
}
interface DueReminder {
  row: LearningContinuationRow;
  task: LightTickTaskRow;
}
const activeTask = (task?: LightTickTaskRow): task is LightTickTaskRow =>
  !!task?.lessonSource && (task.status === "pending" || task.status === "in_progress");

export class LearningContinuationService {
  constructor(private readonly dependencies: Dependencies) {}

  private get repo() { return this.dependencies.repository; }
  private get store() { return this.repo.learningContinuations; }

  async available(): Promise<boolean> {
    return this.dependencies.native().enabled && process.env.LIGHTTICK_MANUAL_PLANNING_ENABLED !== "0" &&
      await this.dependencies.available();
  }

  async runBatch(limit = 64) {
    const result = { moved: 0, adjusted: 0, enqueued: 0, failed: 0 };
    if (!await this.available()) return result;
    const now = (this.dependencies.clock ?? (() => new Date()))();
    for (const candidate of await this.store.listDue(now, limit)) {
      const owner: LightTickOwner = { appId: candidate.appId, userId: candidate.userId };
      try {
        const reminder = await this.repo.transaction(owner, async () => {
          await this.repo.lockPlanningOwner(owner);
          const row = await this.store.get(owner, candidate.taskId);
          if (!row || (row.phase !== "rollover" && row.phase !== "reminder")) return;
          const timezone = (await this.repo.getProfile(owner))?.timezone ?? "UTC";
          const today = businessDateAt(now, timezone);
          if (row.dueDate > today) return;
          const task = await this.repo.getTask(owner, row.taskId);
          if (!activeTask(task) || !await this.dependencies.authorizeOwner(owner)) {
            await this.store.save({ ...row, phase: "finished" });
            return;
          }
          if (row.phase === "reminder") {
            if (row.dueDate !== today || task.version !== row.movedVersion || taskBusinessDate(task, timezone) !== today) {
              await this.store.save({ ...row, phase: "finished" });
              return;
            }
            return row.reminderTime && accountClock(now, timezone) >= row.reminderTime ? { row, task } : undefined;
          }
          const date = taskBusinessDate(task, timezone);
          if (!date) {
            await this.store.save({ ...row, phase: "finished" });
            return;
          }
          if (date !== row.scheduledDate) {
            await this.store.save({ ...row, scheduledDate: date, dueDate: nextBusinessDay(date) });
            return;
          }
          if (row.dueDate < today) {
            await this.store.save({ ...row, phase: "adjustment", adjustmentReason: "missed_next_day" });
            result.adjusted++;
            return;
          }
          const reason = await this.readiness(owner, task, today);
          if (reason) {
            await this.store.save({ ...row, phase: "adjustment", adjustmentReason: reason });
            result.adjusted++;
            return;
          }
          let moved: LightTickTaskRow;
          try {
            moved = await this.dependencies.tasks().command(owner, task.id, task.version, {
              action: "reschedule", date: today, source: "learning_continuation",
            });
          } catch (error) {
            if (!isWeeklyPlanningCapacityError(error) &&
              (!(error instanceof ApplicationError) || error.code !== "LIGHTTICK_PLAN_CONSTRAINT_FAILED")) throw error;
            await this.store.save({ ...row, phase: "adjustment", adjustmentReason: "capacity" });
            result.adjusted++;
            return;
          }
          const updated: LearningContinuationRow = {
            ...row, movedVersion: moved.version, phase: row.reminderTime ? "reminder" : "finished",
          };
          await this.store.save(updated);
          result.moved++;
          return row.reminderTime && accountClock(now, timezone) >= row.reminderTime ? { row: updated, task: moved } : undefined;
        });
        if (reminder && await this.enqueue(owner, reminder)) result.enqueued++;
      } catch {
        // Leave the durable row eligible for a later tick, and continue other accounts.
        result.failed++;
      }
    }
    return result;
  }

  async canDeliver(owner: LightTickOwner, task: LightTickTaskRow): Promise<boolean> {
    if (!await this.available() || this.dependencies.notificationsEnabled && !await this.dependencies.notificationsEnabled()) return false;
    return this.repo.transaction(owner, async () => {
      if (!await this.dependencies.authorizeOwner(owner)) return false;
      const current = await this.repo.getTask(owner, task.id);
      const row = await this.store.get(owner, task.id);
      const timezone = (await this.repo.getProfile(owner))?.timezone ?? "UTC";
      const now = (this.dependencies.clock ?? (() => new Date()))();
      return row?.dueDate === businessDateAt(now, timezone) && activeTask(current) && current.version === task.version && !!row?.reminderTime &&
        (row.phase === "reminder" || row.phase === "enqueued") && row.movedVersion === current.version &&
        !await this.readiness(owner, current, row.dueDate);
    });
  }

  private async enqueue(owner: LightTickOwner, { row, task }: DueReminder): Promise<boolean> {
    const notifications = this.dependencies.notifications();
    if (!notifications || !await this.canDeliver(owner, task)) {
      await this.finishReminder(owner, row, "finished");
      return false;
    }
    const result = await notifications.enqueue(owner, row.dueDate, {
      type: "course_reminder", resource_id: task.id, expected_task_version: task.version,
      title_key: "course_reminder.title", body_key: "course_reminder.body",
    });
    if (result?.queued !== true) return false;
    await this.finishReminder(owner, row, "enqueued");
    return true;
  }

  private async finishReminder(owner: LightTickOwner, row: LearningContinuationRow, phase: "finished" | "enqueued") {
    await this.repo.transaction(owner, async () => {
      await this.repo.lockPlanningOwner(owner);
      const current = await this.store.get(owner, row.taskId);
      if (current?.phase === "reminder" && current.movedVersion === row.movedVersion)
        await this.store.save({ ...current, phase });
    });
  }

  private async readiness(owner: LightTickOwner, task: LightTickTaskRow, target: string): Promise<LearningAdjustmentReason | undefined> {
    const plan = await this.repo.getPlan(owner, task.planId);
    if (!plan || plan.source !== "learning_schedule" || plan.status !== "active" ||
        (plan.proposal.learning_continuation as { enabled?: boolean } | undefined)?.enabled !== true ||
        target < plan.periodStart.slice(0, 10) || target > plan.periodEnd.slice(0, 10)) return "outside_plan";
    if ((await this.repo.getGoal(owner, task.goalId))?.status !== "active") return "goal_paused";
    if ((await this.repo.learningRoutes.getLearningRoute(owner, task.lessonSource!.route_id))?.status !== "active") return "route_paused";
    try {
      const schedule = new LearningSchedulingService(this.dependencies.native(), this.dependencies.tasks(), async () => {});
      await schedule.lesson(owner, task.id);
    } catch (error) {
      if (!(error instanceof ApplicationError) || error.statusCode >= 500) throw error;
      return error.statusCode === 409 ? "prerequisite_incomplete" : "source_unavailable";
    }
  }
}
