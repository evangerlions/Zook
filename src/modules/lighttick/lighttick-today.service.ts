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
    const businessDate = businessDateAt(this.clock(), timezone); const activePlan = await this.repository.getActivePlan(owner);
    if (!activePlan) return { businessDate, timezone, executableTasks: [], completedTasks: [],
      remainingEstimatedMinutes: 0, planBAvailable: false, snapshotVersion: 0, emptyState: "no_active_plan" };
    const goal = await this.repository.getGoal(owner, activePlan.goalId);
    if (goal?.status === "paused") return { businessDate, timezone, planId: activePlan.id,
      executableTasks: [], completedTasks: [], remainingEstimatedMinutes: 0, planBAvailable: false,
      snapshotVersion: Math.max(activePlan.version, goal.version), emptyState: "goal_paused" };
    const tasks = await this.repository.listTasks(owner, activePlan.id);
    const visibleTasks = goal?.status === "recovering"
      ? tasks.filter(task => (task.selectedVariant ?? "standard") !== "standard") : tasks;
    const scheduledToday = visibleTasks.filter(task => !task.scheduledFor || businessDateAt(new Date(task.scheduledFor), timezone) === businessDate);
    const executableTasks = scheduledToday.filter(task => task.status === "pending" || task.status === "in_progress")
      .sort((left, right) => Number(right.status === "in_progress") - Number(left.status === "in_progress") ||
        right.priority - left.priority || (left.scheduledFor ?? "").localeCompare(right.scheduledFor ?? ""));
    const completedTasks = scheduledToday.filter(task => task.status === "completed");
    const remainingEstimatedMinutes = executableTasks.reduce((sum, task) => sum + task.estimatedMinutes, 0);
    return { businessDate, timezone, planId: activePlan.id, primaryTask: executableTasks[0], executableTasks,
      completedTasks, remainingEstimatedMinutes, planBAvailable: executableTasks.length > 1 && remainingEstimatedMinutes > 60,
      snapshotVersion: Math.max(activePlan.version, ...tasks.map(task => task.version), 0),
      emptyState: scheduledToday.length ? undefined : "no_tasks_today" };
  }
}
