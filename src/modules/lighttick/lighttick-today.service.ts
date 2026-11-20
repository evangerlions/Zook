import { learningReadiness, type LearningBlockReason } from "./learning/learning-schedule-prerequisites.ts";
import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickOwner, LightTickTaskRow, LightTickTaskStepRow } from "./lighttick.types.ts";

export interface LightTickTodaySnapshot {
  businessDate: string; timezone: string; planId?: string; primaryTask?: LightTickTaskRow;
  executableTasks: LightTickTaskRow[]; completedTasks: LightTickTaskRow[];
  blockedLearningTasks: { task: LightTickTaskRow; reason: LearningBlockReason }[];
  snapshotRevision?: string;
  remainingEstimatedMinutes: number; planBAvailable: boolean; snapshotVersion: number;
  emptyState?: "no_active_plan" | "no_tasks_today" | "goal_paused";
  taskSteps: LightTickTaskStepRow[];
}

export function businessDateAt(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(instant);
  const value = (type: string) => parts.find(part => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export class LightTickTodayService {
  constructor(private readonly repository: LightTickRepository, private readonly clock = () => new Date()) {}

  async get(owner: LightTickOwner): Promise<LightTickTodaySnapshot> {
    // The owner gate covers the entire read, including task details. A continuation
    // must not commit between reading the old plan and reading its replacement tasks.
    return this.repository.transaction(owner, () => this.project(owner));
  }

  private async project(owner: LightTickOwner): Promise<LightTickTodaySnapshot> {
    const instant = this.clock();
    const profile = await this.repository.getProfile(owner);
    const allTasks = await this.repository.listTasks(owner);
    const allPlans = await this.repository.listPlans(owner);
    const goals = await this.repository.listGoals(owner);
    const taskSteps = await this.repository.listTaskSteps(owner);
    const snapshotRevision = await this.repository.readTodayRevision?.(owner);
    const legacyVersion = (fallback: number) => snapshotRevision === undefined
      ? fallback : Number(BigInt(snapshotRevision) > 2147483647n ? 2147483647n : BigInt(snapshotRevision));
    const timezone = profile?.timezone ?? "UTC";
    const businessDate = businessDateAt(instant, timezone);
    const plans = allPlans.filter(plan => plan.status === "active");
    const hasLearningHistory = allTasks.some(task => task.lessonSource &&
      task.status === "completed" && task.scheduledFor === businessDate);
    if (!plans.length && !hasLearningHistory) return { businessDate, timezone, taskSteps: [], executableTasks: [], completedTasks: [],
      remainingEstimatedMinutes: 0, planBAvailable: false, snapshotVersion: legacyVersion(0), snapshotRevision, blockedLearningTasks: [], emptyState: "no_active_plan" };
    const goalById = new Map(goals.map(goal => [goal.id, goal]));
    const availablePlans = plans.filter(plan => ["active", "recovering"].includes(goalById.get(plan.goalId)?.status ?? ""));
    if (!availablePlans.length && !hasLearningHistory) return { businessDate, timezone, taskSteps: [], executableTasks: [], completedTasks: [],
      remainingEstimatedMinutes: 0, planBAvailable: false, snapshotVersion: legacyVersion(Math.max(...plans.map(plan => plan.version))),
      snapshotRevision, blockedLearningTasks: [],
      emptyState: plans.some(plan => goalById.get(plan.goalId)?.status === "paused") ? "goal_paused" : "no_active_plan" };
    const planById = new Map(availablePlans.map(plan => [plan.id, plan]));
    const historicalPlans = new Map(allPlans
      .filter(plan => ["active", "superseded"].includes(plan.status) &&
        (plan.source === "learning_schedule" || ["active", "recovering"].includes(goalById.get(plan.goalId)?.status ?? "")))
      .map(plan => [plan.id, plan]));
    const tasks = allTasks.filter(task => planById.has(task.planId)||task.status==="completed"&&historicalPlans.has(task.planId));
    const scheduledToday = tasks.filter(task => {
      const plan = planById.get(task.planId)??historicalPlans.get(task.planId)!;
      if (task.status !== "completed" && goalById.get(task.goalId)?.status === "recovering" && (task.selectedVariant ?? "standard") === "standard") return false;
      if (!task.scheduledFor && ["manual_native", "local_adoption"].includes(plan.source)) return false;
      if (!task.scheduledFor) return plan.periodStart.slice(0, 10) <= businessDate && plan.periodEnd.slice(0, 10) >= businessDate;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(task.scheduledFor) ? task.scheduledFor : businessDateAt(new Date(task.scheduledFor), timezone);
      return date === businessDate;
    });
    const readiness = learningReadiness(this.repository, owner);
    const blockedLearningTasks: LightTickTodaySnapshot["blockedLearningTasks"] = [];
    const executable: LightTickTaskRow[] = [];
    for (const task of scheduledToday) {
      if (task.status !== "pending" && task.status !== "in_progress") continue;
      const reason = await readiness(task);
      if (reason) blockedLearningTasks.push({ task, reason });
      else executable.push(task);
    }
    const executableTasks = executable
      .sort((left, right) => Number(right.status === "in_progress") - Number(left.status === "in_progress") ||
        right.priority - left.priority || (left.scheduledFor ?? "").localeCompare(right.scheduledFor ?? ""));
    const completedTasks = scheduledToday.filter(task => task.status === "completed");
    const remainingEstimatedMinutes = executableTasks.reduce((sum, task) => sum + (task.estimatedMinutes ?? 0), 0);
    return { businessDate, timezone, taskSteps: taskSteps.filter(step => scheduledToday.some(task => task.id === step.taskId)), planId: executableTasks[0]?.planId ?? scheduledToday[0]?.planId ?? availablePlans[0]?.id, primaryTask: executableTasks[0], executableTasks,
      completedTasks, blockedLearningTasks, snapshotRevision, remainingEstimatedMinutes, planBAvailable: executableTasks.length > 1 && remainingEstimatedMinutes > 60,
      snapshotVersion: legacyVersion(Math.max(...availablePlans.map(plan => plan.version), ...tasks.map(task => task.version), ...goals.map(goal => goal.version), 0)),
      emptyState: scheduledToday.length ? undefined : "no_tasks_today" };
  }
}
