import type { LearningAdjustmentReason } from "./learning/learning-continuation.types.ts";
import { projectCycleHandoffs, type LightTickCycleHandoff } from "./lighttick-cycle-handoffs.ts";
import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickOwner, LightTickTaskRow, LightTickTaskStepRow } from "./lighttick.types.ts";
import { taskAwaitingExternalInput, taskHasTransferredRemainingWork, taskRemainingEstimate } from "./lighttick-task-progress.ts";

export interface LightTickTodaySnapshot {
  businessDate: string; timezone: string; planId?: string; primaryTask?: LightTickTaskRow;
  executableTasks: LightTickTaskRow[]; completedTasks: LightTickTaskRow[];
  waitingTasks: LightTickTaskRow[]; continuationTasks: LightTickTaskRow[]; unknownRemainingTaskCount: number;
  remainingEstimatedMinutes: number; planBAvailable: boolean; snapshotVersion: number;
  emptyState?: "no_active_plan" | "no_tasks_today" | "goal_paused";
  taskSteps: LightTickTaskStepRow[];
  learningNeedsAdjustment?: { task: LightTickTaskRow; reason: LearningAdjustmentReason }[];
  learningContinuedFrom?: Map<string, string>;
  cycleHandoffs?: LightTickCycleHandoff[];
}

export function businessDateAt(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(instant);
  const value = (type: string) => parts.find(part => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function todayDateAt(instant: Date, timezone: string) {
  try {
    return { timezone, businessDate: businessDateAt(instant, timezone) };
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return { timezone: "UTC", businessDate: businessDateAt(instant, "UTC") };
  }
}

function scheduledDate(task: LightTickTaskRow, timezone: string): string | undefined {
  if (!task.scheduledFor) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(task.scheduledFor)
    ? task.scheduledFor : businessDateAt(new Date(task.scheduledFor), timezone);
}

function isOpenTask(task: LightTickTaskRow): boolean {
  return task.status === "pending" || task.status === "in_progress";
}

function executionOrder(left: LightTickTaskRow, right: LightTickTaskRow): number {
  return Number(right.status === "in_progress") - Number(left.status === "in_progress") ||
    right.priority - left.priority || left.id.localeCompare(right.id);
}

function waitingOrder(left: LightTickTaskRow, right: LightTickTaskRow): number {
  const leftDate = left.executionProgress?.waiting?.checkDate ?? "";
  const rightDate = right.executionProgress?.waiting?.checkDate ?? "";
  return Number(!leftDate) - Number(!rightDate) || leftDate.localeCompare(rightDate) || executionOrder(left, right);
}

export class LightTickTodayService {
  constructor(private readonly repository: LightTickRepository, private readonly clock = () => new Date()) {}

  now(): Date {
    return this.clock();
  }

  async get(owner: LightTickOwner): Promise<LightTickTodaySnapshot> {
    // The owner gate covers the entire read, including task details. A continuation
    // must not commit between reading the old plan and reading its replacement tasks.
    const { timezone, businessDate, allPlans, goals, allTasks, taskSteps, inactiveRoutes, continuations } = await this.repository.transaction(owner, async () => {
      const instant = this.clock();
      const profile = await this.repository.getProfile(owner);
      const authority = await this.repository.getLearningAuthority(owner);
      const canRead = authority?.phase === "zook" && authority.readingEnabled;
      const allTasks = (await this.repository.listTasks(owner)).filter(task => canRead || !task.lessonSource);
      const continuations = canRead ? await this.repository.learningContinuations.list(owner) : [];
      const date = todayDateAt(instant, profile?.timezone ?? "UTC");
      const routeIds = new Set(allTasks.flatMap(task =>
        task.lessonSource && task.scheduledFor === date.businessDate && ["pending", "in_progress"].includes(task.status) ? [task.lessonSource.route_id] : []));
      const inactiveRoutes = new Set<string>();
      for (const id of routeIds) {
        const route = await this.repository.learningRoutes.getLearningRoute(owner, id);
        if (route?.status !== "active") inactiveRoutes.add(id);
      }
      return { ...date, allTasks, inactiveRoutes, continuations, allPlans: await this.repository.listPlans(owner),
        goals: await this.repository.listGoals(owner), taskSteps: await this.repository.listTaskSteps(owner) };
    });
    const plans = allPlans.filter(plan => plan.status === "active");
    const goalById = new Map(goals.map(goal => [goal.id, goal]));
    const continuationByTask = new Map(continuations.map(row => [row.taskId, row]));
    const learningPlans = new Set(plans.filter(plan => plan.source === "learning_schedule" &&
      ["active", "paused", "recovering"].includes(goalById.get(plan.goalId)?.status ?? "")).map(plan => plan.id));
    const learningNeedsAdjustment: NonNullable<LightTickTodaySnapshot["learningNeedsAdjustment"]> = [];
    const learningContinuedFrom = new Map<string, string>();
    for (const task of allTasks) {
      if (!task.lessonSource || !task.scheduledFor || !learningPlans.has(task.planId)) continue;
      const date = task.scheduledFor.slice(0, 10);
      const row = continuationByTask.get(task.id);
      if (row?.movedVersion && row.dueDate === date) learningContinuedFrom.set(task.id, row.scheduledDate);
      if (date >= businessDate || !["pending", "in_progress"].includes(task.status)) continue;
      const reason = row?.scheduledDate === date && row.adjustmentReason ? row.adjustmentReason
        : row?.movedVersion ? "already_continued" : "overdue";
      learningNeedsAdjustment.push({ task, reason });
    }
    learningNeedsAdjustment.sort((left, right) => left.task.scheduledFor!.localeCompare(right.task.scheduledFor!));
    const cycleHandoffs = projectCycleHandoffs(goals, allPlans, businessDate);
    const optionalViews = {
      ...(learningNeedsAdjustment.length ? { learningNeedsAdjustment } : {}),
      ...(learningContinuedFrom.size ? { learningContinuedFrom } : {}),
      ...(cycleHandoffs.length ? { cycleHandoffs } : {}),
    };
    const hasLearningHistory = allTasks.some(task => task.lessonSource &&
      task.status === "completed" && task.scheduledFor === businessDate);
    const emptyExecution = {
      remainingEstimatedMinutes: 0, unknownRemainingTaskCount: 0,
      waitingTasks: [], continuationTasks: [], planBAvailable: false,
    };
    if (!plans.length && !hasLearningHistory) return { ...optionalViews, businessDate, timezone, taskSteps: [], executableTasks: [], completedTasks: [],
      ...emptyExecution, snapshotVersion: 0, emptyState: "no_active_plan" };
    const availablePlans = plans.filter(plan => ["active", "recovering"].includes(goalById.get(plan.goalId)?.status ?? ""));
    if (!availablePlans.length && !hasLearningHistory) return { ...optionalViews, businessDate, timezone, taskSteps: [], executableTasks: [], completedTasks: [],
      ...emptyExecution, snapshotVersion: Math.max(...plans.map(plan => plan.version)),
      emptyState: plans.some(plan => goalById.get(plan.goalId)?.status === "paused") ? "goal_paused" : "no_active_plan" };
    const planById = new Map(availablePlans.map(plan => [plan.id, plan]));
    const historicalPlans = new Map(allPlans
      .filter(plan => ["active", "superseded"].includes(plan.status) &&
        (plan.source === "learning_schedule" || ["active", "recovering"].includes(goalById.get(plan.goalId)?.status ?? "")))
      .map(plan => [plan.id, plan]));
    const tasks = allTasks.filter(task => planById.has(task.planId) || task.status === "completed" && historicalPlans.has(task.planId));
    const visibleTasks = tasks.filter(task => {
      if (task.status === "completed") return !taskHasTransferredRemainingWork(task);
      if (!isOpenTask(task) || taskHasTransferredRemainingWork(task)) return false;
      if (task.lessonSource && inactiveRoutes.has(task.lessonSource.route_id)) return false;
      return goalById.get(task.goalId)?.status !== "recovering" || (task.selectedVariant ?? "standard") !== "standard";
    });
    const scheduledToday = visibleTasks.filter(task => {
      const plan = planById.get(task.planId)??historicalPlans.get(task.planId)!;
      const date = scheduledDate(task, timezone);
      if (date) return date === businessDate;
      return !["manual_native", "local_adoption"].includes(plan.source) &&
        plan.periodStart.slice(0, 10) <= businessDate && plan.periodEnd.slice(0, 10) >= businessDate;
    });
    const executableTasks = scheduledToday.filter(task => isOpenTask(task) && !taskAwaitingExternalInput(task)).sort(executionOrder);
    const completedTasks = scheduledToday.filter(task => task.status === "completed");
    const waitingTasks = visibleTasks.filter(task => isOpenTask(task) && !task.lessonSource && taskAwaitingExternalInput(task))
      .sort(waitingOrder);
    const scheduledIds = new Set(scheduledToday.map(task => task.id));
    const continuationTasks = visibleTasks.filter(task => {
      if (!isOpenTask(task) || task.lessonSource || taskAwaitingExternalInput(task) || !task.executionProgress || scheduledIds.has(task.id)) return false;
      const date = scheduledDate(task, timezone);
      return date ? date < businessDate
        : task.executionProgress.outcome !== undefined || task.executionProgress.remainingWork !== undefined;
    }).sort(executionOrder);
    const shownTasks = [...executableTasks, ...completedTasks, ...waitingTasks, ...continuationTasks];
    const shownIds = new Set(shownTasks.map(task => task.id));
    let remainingEstimatedMinutes = 0;
    let unknownRemainingTaskCount = 0;
    for (const task of executableTasks) {
      const estimate = taskRemainingEstimate(task);
      if (estimate === undefined) unknownRemainingTaskCount++;
      else remainingEstimatedMinutes += estimate;
    }
    return { ...optionalViews, businessDate, timezone, taskSteps: taskSteps.filter(step => shownIds.has(step.taskId)),
      planId: shownTasks[0]?.planId ?? availablePlans[0]?.id, primaryTask: executableTasks[0],
      executableTasks, completedTasks, waitingTasks, continuationTasks, remainingEstimatedMinutes, unknownRemainingTaskCount,
      planBAvailable: executableTasks.length > 1 && remainingEstimatedMinutes > 60,
      snapshotVersion: Math.max(...availablePlans.map(plan => plan.version), ...tasks.map(task => task.version), ...goals.map(goal => goal.version), 0),
      emptyState: shownTasks.length ? undefined : "no_tasks_today",
    };
  }
}
