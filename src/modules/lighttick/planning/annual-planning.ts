import { ApplicationError } from "../../../shared/errors.ts";
import { canReadNativeLearning } from "../learning/native-learning-access.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { taskScheduledDate, todayDateAt } from "../lighttick-today.service.ts";
import { dateOnly } from "../manual/manual-planning.types.ts";
import { GoalRoadmapService, readGoalRoadmap, type GoalRoadmapStage, type StageDefinition } from "./goal-roadmap.ts";
import { isAgendaTaskVisible } from "./planning-agenda.ts";

const allowedGoalId = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;
const editableGoalStatuses = new Set(["draft", "active", "recovering"]);
const maxChangedGoals = 30;

function invalid(message: string): never {
  throw new ApplicationError(400, "REQ_FIELD_INVALID", message);
}

function exactObject(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function calendarYear(year: unknown) {
  if (typeof year !== "number" || !Number.isSafeInteger(year) || year < 1 || year > 9999)
    invalid("Choose a calendar year from 1 to 9999.");
  const label = String(year).padStart(4, "0");
  return { year, starts_on: label + "-01-01", ends_on: label + "-12-31" };
}

type YearWindow = ReturnType<typeof calendarYear>;

function withinYear(date: string, window: YearWindow) {
  return date >= window.starts_on && date <= window.ends_on;
}

function stageInYear(stage: StageDefinition, window: YearWindow) {
  return stage.starts_on === null || (stage.starts_on <= window.ends_on && stage.ends_on! >= window.starts_on);
}

function definition({ id, title, outcome_criteria, starts_on, ends_on }: StageDefinition) {
  return { id, title, outcome_criteria, starts_on, ends_on };
}

function assertAnnualScope(previous: GoalRoadmapStage[], definitions: StageDefinition[], window: YearWindow) {
  const outside = previous.filter(stage => !stageInYear(stage, window)).map(definition);
  const nextOutside = definitions.filter(stage => !stageInYear(stage, window)).map(definition);
  if (JSON.stringify(outside) !== JSON.stringify(nextOutside)) {
    invalid("Keep the roadmap stages outside this year unchanged, and choose dates within the year for newly scheduled stages.");
  }
}

function requestedChanges(input: Record<string, unknown>) {
  if (!exactObject(input, ["year", "changes"]) || !Array.isArray(input.changes) ||
      !input.changes.length || input.changes.length > maxChangedGoals)
    invalid("Review the year and between one and 30 changed goal roadmaps.");
  const seen = new Set<string>();
  return input.changes.map(change => {
    if (!exactObject(change, ["goal_id", "base_version", "stages"]) || typeof change.goal_id !== "string" ||
        !allowedGoalId.test(change.goal_id) || seen.has(change.goal_id) || !Number.isSafeInteger(change.base_version) ||
        Number(change.base_version) < 0 || !Array.isArray(change.stages))
      invalid("Review unique goal IDs, their roadmap versions, and their complete stage lists.");
    seen.add(change.goal_id);
    return { goalId: change.goal_id, input: { base_version: change.base_version, stages: change.stages } };
  });
}

export class AnnualPlanningService {
  constructor(private readonly repository: LightTickRepository, private readonly clock = () => new Date()) {}

  async get(owner: LightTickOwner, yearQuery?: string) {
    if (yearQuery !== undefined && !/^\d{1,4}$/.test(yearQuery)) invalid("Choose a valid calendar year.");
    return this.repository.transaction(owner, async () => {
      const now = this.clock();
      const date = todayDateAt(now, (await this.repository.getProfile(owner))?.timezone ?? "UTC");
      const window = calendarYear(Number(yearQuery ?? date.businessDate.slice(0, 4)));
      return this.project(owner, window, date);
    });
  }

  async confirm(owner: LightTickOwner, input: Record<string, unknown>) {
    const changes = requestedChanges(input);
    const window = calendarYear(input.year);
    const roadmap = new GoalRoadmapService(this.repository, this.clock);
    return this.repository.transaction(owner, async () => {
      await this.repository.lockPlanningOwner(owner);
      for (const change of changes) {
        await roadmap.update(owner, change.goalId, change.input,
          (previous, definitions) => assertAnnualScope(previous, definitions, window));
      }
      const now = this.clock();
      const date = todayDateAt(now, (await this.repository.getProfile(owner))?.timezone ?? "UTC");
      return this.project(owner, window, date);
    });
  }

  private async project(owner: LightTickOwner, window: YearWindow, date: ReturnType<typeof todayDateAt>) {
    const canReadLearning = canReadNativeLearning(await this.repository.getLearningAuthority(owner));
    const tasks = await this.repository.listPlanningAgendaTasks(owner, window.starts_on, window.ends_on, canReadLearning);
    const plans = new Map((await this.repository.listPlans(owner)).map(plan => [plan.id, plan]));
    const goalById = new Map((await this.repository.listGoals(owner)).map(goal => [goal.id, goal]));
    const months = Array.from({ length: 12 }, (_, index) => ({
      month: window.starts_on.slice(0, 4) + "-" + String(index + 1).padStart(2, "0"),
      scheduled_actions: 0,
      completed_actions: 0,
    }));
    const seenTasks = new Set<string>();
    const goalsWithActions = new Set<string>();
    for (const task of tasks) {
      const goal = goalById.get(task.goalId), plan = plans.get(task.planId);
      if (!goal || !plan || seenTasks.has(task.id) || !isAgendaTaskVisible(task, goal, plan, true)) continue;
      const scheduledDate = taskScheduledDate(task, date.timezone);
      if (!scheduledDate || !withinYear(scheduledDate, window)) continue;
      seenTasks.add(task.id);
      goalsWithActions.add(goal.id);
      const month = months[Number(scheduledDate.slice(5, 7)) - 1]!;
      month.scheduled_actions++;
      if (task.status === "completed") month.completed_actions++;
    }
    const goals = [...goalById.values()].flatMap(goal => {
      const roadmap = readGoalRoadmap(goal);
      const deadline = goal.targetDate?.slice(0, 10);
      const stages = roadmap.stages.filter(stage => stageInYear(stage, window));
      if (!editableGoalStatuses.has(goal.status) && !goalsWithActions.has(goal.id) &&
          !stages.some(stage => stage.starts_on !== null) && (!deadline || !withinYear(deadline, window))) return [];
      return [{
        goal_id: goal.id, title: goal.title, status: goal.status, deadline: dateOnly(deadline) ? deadline : null,
        roadmap_version: roadmap.version, stages: stages.map(stage => ({ ...definition(stage), outcome: stage.outcome })),
      }];
    });
    return { ...window, business_date: date.businessDate, timezone: date.timezone, goals, months };
  }
}
