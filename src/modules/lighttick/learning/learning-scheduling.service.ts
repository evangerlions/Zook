import { ApplicationError } from "../../../shared/errors.ts";
import { sha256 } from "../../../shared/utils.ts";
import type { LightTickGoalRow, LightTickLessonSource, LightTickOwner, LightTickPlanRow, LightTickTaskRow } from "../lighttick.types.ts";
import { businessDateAt } from "../lighttick-today.service.ts";
import type { LightTickTaskService } from "../lighttick-task.service.ts";
import { ManualPlanningService, canonical, manualTaskData } from "../manual/manual-planning.service.ts";
import { invalid, validateManualDraft, type ManualAction, type ManualDraft } from "../manual/manual-planning.types.ts";
import { assertLearningCapacity, taskBusinessDate, type LearningScheduleBudget } from "./learning-schedule-capacity.ts";
import { LearningRouteService } from "./learning-route.service.ts";
import type { NativeLearningService } from "./native-learning.service.ts";
import { nextBusinessDay, type LearningContinuationPreference } from "./learning-continuation.types.ts";
import type { LearningWorkService } from "./learning-work.service.ts";
import { TutorObservations } from "./tutor-observations.ts";

export interface LearningScheduleObservationSource {
  lesson_id: string;
  content_version: string;
  revision: number;
}

export interface LearningScheduleDraft extends LearningScheduleBudget {
  goal_id: string;
  goal_base_version: number;
  route_id: string;
  route_version: number;
  period_start: string;
  period_end: string;
  learning_continuation?: LearningContinuationPreference;
  observation_source?: LearningScheduleObservationSource;
  items: {
    id: string;
    lesson_number: number;
    purpose: LightTickLessonSource["purpose"];
    scheduled_for: string;
    estimated_minutes: number;
  }[];
}
export interface LearningScheduleCompletion {
  base_version: number;
  lesson_id: string;
  content_version: string;
  completion_base_revision: number;
}

function conflict(message: string): never {
  throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", message);
}
function missing(message: string): never {
  throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", message);
}
const purposeLabel = { learn: "Learn", review: "Review", apply: "Practice" };
const pending = (task: LightTickTaskRow) => ["pending", "in_progress"].includes(task.status);

export class LearningSchedulingService {
  private readonly routes: LearningRouteService;
  private readonly manual: ManualPlanningService;
  constructor(readonly native: NativeLearningService, readonly tasks: LightTickTaskService,
    authorize: () => Promise<void>, readonly continuationAvailable = async () => false,
    readonly learningWork?: LearningWorkService) {
    this.routes = new LearningRouteService(native);
    this.manual = new ManualPlanningService(native.repository, native.clock, authorize, "learning_schedule");
  }
  private get repo() { return this.manual.repository; }

  private async access(owner: LightTickOwner, write = false) {
    const authority = await this.routes.access(owner);
    if (write && (!this.native.enabled || process.env.LIGHTTICK_MANUAL_PLANNING_ENABLED === "0")) {
      throw new ApplicationError(503, "LIGHTTICK_APP_DISABLED", "Learning schedule writes are unavailable.");
    }
    return authority;
  }

  private async planData(owner: LightTickOwner, id: string) {
    const data = await this.manual.get(owner, id);
    const plan = (await this.repo.getPlan(owner, id))!;
    return this.withSettings(data, plan);
  }

  private withSettings<T extends { draft: ManualDraft }>(data: T, plan: LightTickPlanRow) {
    const continuation = plan.proposal.learning_continuation as unknown as LearningContinuationPreference | undefined;
    const observation = plan.proposal.learning_observation as LearningScheduleObservationSource | undefined;
    return { ...data, draft: { ...data.draft, ...(continuation ? { learning_continuation: continuation } : {}),
      ...(observation ? { observation_source: observation } : {}) },
      budget: plan.proposal.learning_budget as unknown as LearningScheduleBudget };
  }

  private async assertObservation(owner: LightTickOwner, draft: ManualDraft, source?: LearningScheduleObservationSource) {
    if (!source) return;
    const matches = draft.tasks.filter(item => item.lesson_source?.lesson_id === source.lesson_id &&
      item.lesson_source.content_version === source.content_version && item.lesson_source.purpose === "review");
    if (matches.length !== 1 || !this.learningWork)
      conflict("The review does not match the lesson and version of the selected observation.");
    const current = await new TutorObservations(this.learningWork).snapshot(owner, source.lesson_id, source.content_version);
    if (!current || current.revision !== source.revision || (current.goalId !== null && current.goalId !== draft.goal_id))
      conflict("The learning observation changed. Review the current evidence or make a separate manual arrangement.");
  }

  private async requireContinuation(preference?: LearningContinuationPreference) {
    if (preference?.enabled && !await this.continuationAvailable())
      throw new ApplicationError(503, "LIGHTTICK_APP_DISABLED", "Automatic learning continuation is unavailable.");
  }

  async get(owner: LightTickOwner, id: string) {
    return this.repo.transaction(owner, async () => {
      await this.access(owner);
      return this.planData(owner, id);
    });
  }

  draft(owner: LightTickOwner, key: string, input: LearningScheduleDraft) {
    return this.repo.transaction(owner, async () => {
      await this.access(owner);
      await this.requireContinuation(input.learning_continuation);
      return this.manual.operation(owner, key, "learning.schedule.preview", input, () => this.prepare(owner, key, input));
    });
  }

  private async prepare(owner: LightTickOwner, key: string, input: LearningScheduleDraft) {
      await this.access(owner, true);
      const goal = await this.repo.getGoal(owner, input.goal_id);
      if (!goal) missing("Goal was not found.");
      if (goal.version !== input.goal_base_version) conflict("The goal changed. Refresh and review the schedule.");
      const route = await this.routes.require(owner, input.route_id);
      if (route.status !== "active" || route.publishedVersion !== input.route_version) conflict("Review the current active course version.");
      const outline = await this.repo.learningRoutes.getLearningRouteVersion(owner, route.id, input.route_version);
      if (!outline) missing("Published course version was not found.");
      const links = await this.repo.learningRoutes.listRouteLessonLinks(owner, route.id);
      const actions: ManualAction[] = [];
      for (const item of input.items) {
        const spec = outline.document.lessons[item.lesson_number - 1];
        const link = links.find(link => link.number === item.lesson_number && link.routeVersion <= input.route_version);
        if (!spec || !link) invalid("Publish this lesson body before scheduling it.");
        const { publication } = await this.native.publication(owner, link.lessonId);
        const source: LightTickLessonSource = {
          route_id: route.id, route_version: input.route_version, lesson_number: item.lesson_number,
          lesson_id: link.lessonId, content_version: publication.contentVersion, purpose: item.purpose,
        };
        actions.push({
          id: item.id, title: (item.purpose === "learn" ? spec.topic : purposeLabel[item.purpose] + " · " + spec.topic).slice(0, 200),
          scheduled_for: item.scheduled_for, estimated_minutes: item.estimated_minutes,
          completion_criteria: spec.assessment.slice(0, 1000), guidance: spec.exercise.slice(0, 1000), lesson_source: source,
        });
      }
      const draft: ManualDraft = {
        goal_id: goal.id, title: route.brief.title, completion_criteria: "", period_start: input.period_start,
        period_end: input.period_end, tasks: actions,
      };
      const timezone = (await this.repo.getProfile(owner))?.timezone ?? "UTC";
      validateManualDraft(draft);
      await this.assertObservation(owner, draft, input.observation_source);
      await this.validate(owner, goal, draft, await this.repo.listTasks(owner), timezone, input);
      const budget: LearningScheduleBudget = {
        available_daily_minutes: input.available_daily_minutes, available_weekly_minutes: input.available_weekly_minutes,
      };
      const saved = await this.manual.create(owner, "schedule-draft-" + sha256(key).slice(0, 48), draft, {
        learning_budget: budget,
        ...(input.observation_source ? { learning_observation: input.observation_source } : {}),
        ...(input.learning_continuation ? { learning_continuation: input.learning_continuation } : {}),
      });
      return this.withSettings(saved, (await this.repo.getPlan(owner, saved.id))!);
  }

  confirm(owner: LightTickOwner, id: string, key: string, input: { base_version: number; goal_base_version: number }) {
    return this.repo.transaction(owner, async () => {
      // Recheck reading consent even when an accepted receipt exists.
      await this.access(owner);
      const saved = await this.manual.confirm(owner, id, key, input, async (plan, goal, draft, tasks, timezone) => {
        await this.access(owner, true);
        await this.requireContinuation(plan.proposal.learning_continuation as unknown as LearningContinuationPreference | undefined);
        await this.assertObservation(owner, draft, plan.proposal.learning_observation as LearningScheduleObservationSource | undefined);
        await this.validate(owner, goal, draft, tasks, timezone, plan.proposal.learning_budget as unknown as LearningScheduleBudget);
      });
      const plan = (await this.repo.getPlan(owner, id))!;
      const preference = plan.proposal.learning_continuation as unknown as LearningContinuationPreference | undefined;
      if (preference?.enabled) {
        for (const task of saved.tasks) {
          if (!task.scheduled_date || await this.repo.learningContinuations.get(owner, task.id)) continue;
          await this.repo.learningContinuations.save({
            ...owner, taskId: task.id, scheduledDate: task.scheduled_date, dueDate: nextBusinessDay(task.scheduled_date),
            phase: "rollover", reminderTime: preference.reminder_time,
          });
        }
      }
      return this.withSettings(saved, plan);
    });
  }

  stop(owner: LightTickOwner, id: string, key: string, input: { base_version: number }) {
    return this.repo.transaction(owner, async () => {
      await this.access(owner);
      return this.manual.operation(owner, key, "learning.schedule.stop:" + id, input, async () => {
        const plan = await this.repo.getPlan(owner, id);
        if (!plan || plan.source !== "learning_schedule") missing("Learning schedule was not found.");
        if (plan.version !== input.base_version || !["proposed", "active"].includes(plan.status)) {
          conflict("The schedule changed. Refresh before stopping it.");
        }
        const now = this.native.clock().toISOString();
        for (const task of await this.repo.listTasks(owner, id)) {
          if (!["pending", "in_progress"].includes(task.status)) continue;
          await this.repo.saveTask({ ...task, status: "cancelled", updatedAt: now },
            this.manual.write(owner, "task", task.id, task.version + 1, "task_cancel", now, { status: "cancelled" }), task.version);
        }
        await this.repo.savePlan({ ...plan, status: "superseded", updatedAt: now },
          this.manual.write(owner, "plan", id, plan.version + 1, "learning_schedule_stopped", now, { status: "superseded" }), plan.version);
        return this.planData(owner, id);
      });
    });
  }

  private async validate(owner: LightTickOwner, goal: LightTickGoalRow, draft: ManualDraft, tasks: LightTickTaskRow[], timezone: string, budget: LearningScheduleBudget) {
    const routeId = draft.tasks[0].lesson_source!.route_id;
    const route = await this.routes.require(owner, routeId);
    const version = draft.tasks[0].lesson_source!.route_version;
    if (route.status !== "active" || route.publishedVersion !== version) conflict("The course changed. Prepare a new schedule preview.");
    const outline = await this.repo.learningRoutes.getLearningRouteVersion(owner, routeId, version);
    if (!outline) missing("Published course version was not found.");
    const goals = await this.repo.listGoals(owner);
    const active = new Set(goals.filter(item => !["completed", "archived"].includes(item.status)).map(item => item.id));
    const plans = await this.repo.listPlans(owner);
    if (plans.some(plan => {
      if (plan.source !== "learning_schedule" || plan.status !== "active" || !active.has(plan.goalId)) return false;
      const existingRouteId = (plan.proposal.draft as unknown as ManualDraft).tasks[0]?.lesson_source?.route_id;
      return plan.goalId !== goal.id || existingRouteId !== routeId;
    })) {
      conflict("An existing learning goal and course are active. Review or stop those arrangements first.");
    }
    const facts = await this.repo.learningRoutes.readRouteProgressFacts(owner, routeId);
    const authority = await this.access(owner);
    const completed = new Set(facts.filter(fact => fact.sourceCompleted || (authority.privateEnabled && fact.completed)).map(fact => fact.number));
    const today = businessDateAt(this.native.clock(), timezone);
    const seen = new Set<string>();
    for (const item of draft.tasks) {
      const source = item.lesson_source!;
      const date = item.scheduled_for!;
      if (date < today) invalid("Schedule lessons from the account's current business day onward.");
      const { publication } = await this.native.publication(owner, source.lesson_id);
      if (publication.contentVersion !== source.content_version) conflict("The lesson body changed. Review a new preview.");
      const identity = source.lesson_id + ":" + source.purpose;
      if (seen.has(identity) || tasks.some(task => pending(task) && task.lessonSource?.lesson_id === source.lesson_id && task.lessonSource.purpose === source.purpose)) {
        conflict("This lesson and purpose already have an outstanding arrangement.");
      }
      seen.add(identity);
      if ((source.purpose === "learn") === completed.has(source.lesson_number)) {
        invalid(source.purpose === "learn" ? "This lesson is already complete. Choose review or practice." : "Finish the lesson before arranging review or practice.");
      }
      const lesson = outline.document.lessons[source.lesson_number - 1];
      for (const required of lesson.requires) {
        if (completed.has(required)) continue;
        const reviewed = draft.tasks.some(other => other.lesson_source?.lesson_number === required && other.lesson_source.purpose === "learn" && other.scheduled_for! <= date);
        const confirmed = tasks.some(task => pending(task) && task.lessonSource?.route_id === routeId &&
          task.lessonSource.lesson_number === required && task.lessonSource.purpose === "learn" &&
          !!task.scheduledFor && taskBusinessDate(task, timezone)! <= date);
        if (!reviewed && !confirmed) invalid("Schedule or finish the prerequisite lesson first.");
      }
    }
    assertLearningCapacity(goal, budget, draft.tasks, tasks, timezone);
  }

  async lesson(owner: LightTickOwner, taskId: string) {
    return this.repo.transaction(owner, async () => {
      await this.access(owner);
      const task = await this.repo.getTask(owner, taskId);
      if (!task?.lessonSource) missing("Scheduled lesson was not found.");
      if (pending(task)) await this.assertReady(owner, task);
      const source = task.lessonSource;
      await this.native.publication(owner, source.lesson_id, source.content_version);
      const timezone = (await this.repo.getProfile(owner))?.timezone ?? "UTC";
      return { task: manualTaskData(task, timezone), lesson_source: source };
    });
  }

  private async assertReady(owner: LightTickOwner, task: LightTickTaskRow) {
    const source = task.lessonSource!;
    const route = await this.routes.require(owner, source.route_id);
    const goal = await this.repo.getGoal(owner, task.goalId);
    const plan = await this.repo.getPlan(owner, task.planId);
    if (route.status !== "active" || goal?.status !== "active" || plan?.status !== "active") {
      conflict("Resume the course and its goal before executing the arrangement.");
    }
    const outline = await this.repo.learningRoutes.getLearningRouteVersion(owner, route.id, source.route_version);
    const spec = outline?.document.lessons[source.lesson_number - 1];
    if (!spec) missing("The scheduled course version was not found.");
    const authority = await this.access(owner);
    const facts = await this.repo.learningRoutes.readRouteProgressFacts(owner, route.id);
    if (spec.requires.some(required => !facts.some(fact => fact.number === required &&
        (fact.sourceCompleted || (authority.privateEnabled && fact.completed))))) {
      conflict("Finish the prerequisite lesson before opening this scheduled lesson.");
    }
  }

  complete(owner: LightTickOwner, taskId: string, key: string, input: LearningScheduleCompletion) {
    return this.repo.transaction(owner, async () => {
      const authority = await this.access(owner);
      if (!authority.privateEnabled) throw new ApplicationError(403, "APP_SCOPE_FORBIDDEN", "Private learning consent is required.");
      return this.manual.operation(owner, key, "learning.schedule.complete:" + taskId, input, async () => {
        await this.access(owner, true);
        const task = await this.repo.getTask(owner, taskId);
        const source = task?.lessonSource;
        if (!task || !source) missing("Scheduled lesson was not found.");
        if (task.version !== input.base_version || !pending(task) ||
            source.lesson_id !== input.lesson_id || source.content_version !== input.content_version) {
          conflict("The assignment or lesson version changed. Refresh and review before completing.");
        }
        await this.assertReady(owner, task);
        const previous = await this.native.privateState(owner, source.lesson_id, source.content_version);
        if (previous.completionRevision !== input.completion_base_revision) conflict("Lesson completion changed. Refresh and review.");
        const learning = previous.completed || source.purpose !== "learn"
          ? { completed: previous.completed, completion_revision: previous.completionRevision } :
          await this.native.privateCommand(owner, source.lesson_id, {
            action: "complete", content_version: source.content_version, base_revision: input.completion_base_revision,
          }, "schedule-complete-" + sha256(canonical({ key, taskId })).slice(0, 40));
        const completed = await this.tasks.command(owner, taskId, input.base_version, { action: "complete" });
        return {
          task: manualTaskData(completed),
          learning: { completed: learning.completed, completion_revision: learning.completion_revision },
        };
      });
    });
  }
}
