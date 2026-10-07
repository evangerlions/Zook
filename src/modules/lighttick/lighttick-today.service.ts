import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickOwner, LightTickTaskRow } from "./lighttick.types.ts";

export interface LightTickTodaySnapshot {
  businessDate: string; timezone: string; planId?: string; primaryTask?: LightTickTaskRow;
  executableTasks: LightTickTaskRow[]; completedTasks: LightTickTaskRow[];
  remainingEstimatedMinutes: number; planBAvailable: boolean; snapshotVersion: number;
  emptyState?: "no_active_plan" | "no_tasks_today" | "goal_paused";
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
    const profile = await this.repository.getProfile(owner); const timezone = profile?.timezone ?? "UTC";
    const businessDate = businessDateAt(this.clock(), timezone);
    const plans = (await this.repository.listPlans(owner)).filter(plan => plan.status === "active");
    if (!plans.length) return { businessDate, timezone, executableTasks: [], completedTasks: [],
      remainingEstimatedMinutes: 0, planBAvailable: false, snapshotVersion: 0, emptyState: "no_active_plan" };
    const goals = await this.repository.listGoals(owner);
    const goalById = new Map(goals.map(goal => [goal.id, goal]));
    const availablePlans = plans.filter(plan => ["active", "recovering"].includes(goalById.get(plan.goalId)?.status ?? ""));
    if (!availablePlans.length) return { businessDate, timezone, executableTasks: [], completedTasks: [],
      remainingEstimatedMinutes: 0, planBAvailable: false, snapshotVersion: Math.max(...plans.map(plan => plan.version)),
      emptyState: plans.some(plan => goalById.get(plan.goalId)?.status === "paused") ? "goal_paused" : "no_active_plan" };
    const planById = new Map(availablePlans.map(plan => [plan.id, plan]));
    const tasks = (await this.repository.listTasks(owner)).filter(task => planById.has(task.planId));
    const scheduledToday = tasks.filter(task => {
      const plan = planById.get(task.planId)!;
      if (goalById.get(task.goalId)?.status === "recovering" && (task.selectedVariant ?? "standard") === "standard") return false;
      if (!task.scheduledFor) return plan.periodStart.slice(0, 10) <= businessDate && plan.periodEnd.slice(0, 10) >= businessDate;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(task.scheduledFor) ? task.scheduledFor : businessDateAt(new Date(task.scheduledFor), timezone);
      return date === businessDate;
    });
    const executableTasks = scheduledToday.filter(task => task.status === "pending" || task.status === "in_progress")
      .sort((left, right) => Number(right.status === "in_progress") - Number(left.status === "in_progress") ||
        right.priority - left.priority || (left.scheduledFor ?? "").localeCompare(right.scheduledFor ?? ""));
    const completedTasks = scheduledToday.filter(task => task.status === "completed");
    const remainingEstimatedMinutes = executableTasks.reduce((sum, task) => sum + task.estimatedMinutes, 0);
    return { businessDate, timezone, planId: executableTasks[0]?.planId ?? scheduledToday[0]?.planId ?? availablePlans[0].id, primaryTask: executableTasks[0], executableTasks,
      completedTasks, remainingEstimatedMinutes, planBAvailable: executableTasks.length > 1 && remainingEstimatedMinutes > 60,
      snapshotVersion: Math.max(...availablePlans.map(plan => plan.version), ...tasks.map(task => task.version), ...goals.map(goal => goal.version), 0),
      emptyState: scheduledToday.length ? undefined : "no_tasks_today" };
  }
}
