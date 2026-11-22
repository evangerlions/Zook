import { ApplicationError } from "../../../shared/errors.ts";
import { randomId } from "../../../shared/utils.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickGoalRow, LightTickOwner, LightTickPlanRow } from "../lighttick.types.ts";
import { todayDateAt } from "../lighttick-today.service.ts";
import {
  GOAL_SUBJECTS_KEY, maxPriorSubjectOutcomes, normalizeGoalSubjects, readGoalSubjects, subjectIdForPlan,
  validGoalSubjectId, type GoalSubject, type GoalSubjectOutcome,
} from "./goal-subjects.ts";
import { projectGoalSubjectUsage } from "./weekly-capacity.ts";

function invalid(message: string): never {
  throw new ApplicationError(400, "REQ_FIELD_INVALID", message);
}

interface Revision {
  subjects: GoalSubject[];
  eventType: string;
  payload: Record<string, unknown>;
}

export class GoalSubjectsService {
  constructor(private readonly repository: LightTickRepository, private readonly clock = () => new Date()) {}

  async get(owner: LightTickOwner, goalId: string) {
    return this.repository.transaction(owner, async () => {
      const goal = await this.goal(owner, goalId), state = readGoalSubjects(goal);
      const plans = state.subjects.length ? await this.repository.listPlans(owner, goalId) : [];
      return this.project(goal, state, plans);
    });
  }

  update(owner: LightTickOwner, goalId: string, input: Record<string, unknown>) {
    if (Object.keys(input).length !== 2 || !Object.hasOwn(input, "subjects") || !Object.hasOwn(input, "base_version"))
      invalid("Review the subject version and definitions.");
    const definitions = normalizeGoalSubjects(input.subjects);
    return this.mutate(owner, goalId, input.base_version, async (subjects, plans) => {
      const previous = new Map(subjects.map(subject => [subject.id, subject]));
      const updated: GoalSubject[] = definitions.map(definition => {
        const original = previous.get(definition.id);
        previous.delete(definition.id);
        return { ...definition, latest_outcome: original?.latest_outcome ?? null,
          ...(original?.outcome_history ? { outcome_history: original.outcome_history } : {}) };
      });
      if ([...previous.values()].some(subject => subject.latest_outcome ||
        plans.some(plan => subjectIdForPlan(plan) === subject.id)))
        throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Archive subjects with linked plans or evidence to retain their history.");
      return { subjects: updated, eventType: "goal_subjects_updated", payload: { subject_ids: updated.map(subject => subject.id) } };
    });
  }

  recordOutcome(owner: LightTickOwner, goalId: string, subjectId: string, input: Record<string, unknown>) {
    const { task_id } = input;
    const note = typeof input.note === "string" && input.note.length <= 2000 ? input.note.trim() : "";
    if (!note || Object.keys(input).some(key => !["base_version", "note", "task_id"].includes(key)) ||
      (task_id !== undefined && !validGoalSubjectId(task_id))) invalid("Review the subject evidence and optional action.");
    return this.mutate(owner, goalId, input.base_version, async (subjects, plans, recorded_at) => {
      const subject = subjects.find(item => item.id === subjectId);
      if (!subject || subject.archived)
        throw new ApplicationError(409, "LIGHTTICK_PLANNING_SUBJECT_UNAVAILABLE", "Choose an available subject for this goal.");
      if (task_id) {
        const task = await this.repository.getTask(owner, task_id);
        const plan = task && plans.find(item => item.id === task.planId);
        if (!task || task.goalId !== goalId || !plan || subjectIdForPlan(plan) !== subjectId ||
          (task.status !== "completed" && !task.executionProgress?.outcome))
          throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Subject action evidence was not found.");
      }
      const outcome: GoalSubjectOutcome = { note, recorded_at, ...(task_id ? { task_id } : {}) };
      const history = subject.latest_outcome ? [...(subject.outcome_history ?? []), subject.latest_outcome].slice(-maxPriorSubjectOutcomes) : [];
      const updated = subjects.map(item => item.id === subjectId ?
        { ...item, latest_outcome: outcome, ...(history.length ? { outcome_history: history } : {}) } : item);
      return { subjects: updated, eventType: "goal_subject_outcome_recorded",
        payload: { subject_id: subjectId, subject_title: subject.title, outcome_criteria: subject.outcome_criteria, ...outcome } };
    });
  }

  private async goal(owner: LightTickOwner, goalId: string) {
    const goal = await this.repository.getGoal(owner, goalId);
    if (!goal) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Goal was not found.");
    return goal;
  }

  private async project(goal: LightTickGoalRow, state: ReturnType<typeof readGoalSubjects>, plans: LightTickPlanRow[]) {
    const profile = await this.repository.getProfile(goal);
    const { timezone, businessDate } = todayDateAt(this.clock(), profile?.timezone ?? "UTC");
    const tasks = state.subjects.length && plans.length ? (await this.repository.listTasks(goal)).filter(task => task.goalId === goal.id) : [];
    return { goal_id: goal.id, version: state.version, ...projectGoalSubjectUsage(goal, state.subjects, businessDate, timezone, tasks, plans) };
  }

  private mutate(owner: LightTickOwner, goalId: string, base: unknown,
    revise: (subjects: GoalSubject[], plans: LightTickPlanRow[], now: string) => Promise<Revision>) {
    if (typeof base !== "number" || !Number.isSafeInteger(base) || base < 0) invalid("Use the latest subject version.");
    return this.repository.transaction(owner, async () => {
      await this.repository.lockPlanningOwner(owner);
      const goal = await this.goal(owner, goalId), state = readGoalSubjects(goal);
      if (!["draft", "active", "recovering"].includes(goal.status))
        throw new ApplicationError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "Paused or ended goal subjects are read-only.");
      if (state.version !== base)
        throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Subjects changed. Review the latest definitions before saving.");
      const plans = await this.repository.listPlans(owner, goalId);
      const timestamp = this.clock().toISOString();
      const revision = await revise(state.subjects, plans, timestamp);
      const next = { ...state, version: state.version + 1, subjects: revision.subjects };
      const constraints = { ...goal.constraints, [GOAL_SUBJECTS_KEY]: next };
      const saved = await this.repository.saveGoal({ ...goal, constraints, updatedAt: timestamp }, {
        event: { ...owner, id: randomId("lighttick_event"), aggregateType: "goal", aggregateId: goal.id,
          eventType: revision.eventType, aggregateVersion: goal.version + 1,
          payload: { subject_version: next.version, ...revision.payload }, occurredAt: timestamp, createdAt: timestamp },
        change: { ...owner, entityType: "goal", entityId: goal.id, entityVersion: goal.version + 1, operation: "upsert",
          snapshot: { id: goal.id, title: goal.title, status: goal.status, constraints, version: goal.version + 1 }, changedAt: timestamp },
      }, goal.version);
      return this.project(saved, next, plans);
    });
  }
}
