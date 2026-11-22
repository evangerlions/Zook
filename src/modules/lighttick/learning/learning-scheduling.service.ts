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
import type { LearningRoute, LearningRouteRepository } from "./learning-route.types.ts";
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
  replace_tasks?: NonNullable<ManualDraft["replace_tasks"]>;
  items: {
    id: string;
    lesson_number: number;
    purpose: LightTickLessonSource["purpose"];
    scheduled_for: string;
    estimated_minutes: number;
    source_task_id?: string;
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
type ScheduleReceipt = Awaited<ReturnType<ManualPlanningService["get"]>>;
type ScheduleFacts = Awaited<ReturnType<LearningRouteRepository["readRouteProgressFacts"]>>;

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

  private withSettings(data: ScheduleReceipt, plan: LightTickPlanRow) {
    const continuation = plan.proposal.learning_continuation as unknown as LearningContinuationPreference | undefined;
    const observation = plan.proposal.learning_observation as LearningScheduleObservationSource | undefined;
    const routeId = data.draft.tasks[0]?.lesson_source?.route_id;
    const withinSchedule = (task: ScheduleReceipt["tasks"][number]) => !!routeId && task.goal_id === data.goal_id &&
      task.lesson_source?.route_id === routeId && !!task.scheduled_date &&
      task.scheduled_date >= data.draft.period_start && task.scheduled_date <= data.draft.period_end;
    return { ...data, draft: { ...data.draft, ...(continuation ? { learning_continuation: continuation } : {}),
      ...(observation ? { observation_source: observation } : {}) },
      replaced_tasks: data.replaced_tasks.filter(withinSchedule),
      preserved_tasks: data.preserved_tasks.filter(task => task.status !== "cancelled" && withinSchedule(task)),
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

  async upcoming(owner: LightTickOwner, goalId: string, routeId: string) {
    return this.repo.transaction(owner, async () => {
      const authority = await this.access(owner);
      const goal = await this.repo.getGoal(owner, goalId);
      if (!goal) missing("Goal was not found.");
      const route = await this.routes.require(owner, routeId);
      if (goal.status !== "active" || route.status !== "active" || !route.publishedVersion) return { items: [] };
      const timezone = (await this.repo.getProfile(owner))?.timezone ?? "UTC";
      const today = businessDateAt(this.native.clock(), timezone);
      const plans = await this.repo.listPlans(owner, goal.id);
      const outstanding = this.outstandingForRoute(await this.repo.listTasks(owner), plans, goal.id, route.id);
      const facts = await this.repo.learningRoutes.readRouteProgressFacts(owner, route.id);
      const tasks = await this.adjustableTasks(owner, route, outstanding, facts, authority.privateEnabled, timezone, today);
      const items = tasks.map(task => ({
        id: task.id, version: task.version, title: task.title, scheduled_date: taskBusinessDate(task, timezone)!,
        estimated_duration_minutes: task.estimatedMinutes, status: "pending" as const, lesson_source: task.lessonSource!,
      }));
      return { items: items.sort((left, right) => left.scheduled_date.localeCompare(right.scheduled_date) ||
        left.id.localeCompare(right.id)) };
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
      const { draft, budget } = await this.review(owner, input);
      const saved = await this.manual.create(owner, "schedule-draft-" + sha256(key).slice(0, 48), draft, {
        learning_budget: budget,
        ...(input.observation_source ? { learning_observation: input.observation_source } : {}),
        ...(input.learning_continuation ? { learning_continuation: input.learning_continuation } : {}),
      });
      return this.withSettings(saved, (await this.repo.getPlan(owner, saved.id))!);
  }

  review(owner: LightTickOwner, input: LearningScheduleDraft): Promise<{ draft: ManualDraft; budget: LearningScheduleBudget }> {
    return this.repo.transaction(owner, async () => {
      await this.access(owner);
      await this.requireContinuation(input.learning_continuation);
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
          ...(item.source_task_id ? { source_task_id: item.source_task_id } : {}),
        });
      }
      const draft = validateManualDraft({
        goal_id: goal.id, title: route.brief.title, completion_criteria: "", period_start: input.period_start,
        period_end: input.period_end, tasks: actions,
        ...(input.replace_tasks ? { replace_tasks: input.replace_tasks } : {}),
      });
      const timezone = (await this.repo.getProfile(owner))?.timezone ?? "UTC";
      await this.assertObservation(owner, draft, input.observation_source);
      await this.validate(owner, goal, draft, await this.repo.listTasks(owner), timezone, input);
      const budget = {
        available_daily_minutes: input.available_daily_minutes, available_weekly_minutes: input.available_weekly_minutes,
      };
      return { draft, budget };
    });
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

  private outstandingForRoute(tasks: LightTickTaskRow[], plans: LightTickPlanRow[], goalId: string, routeId: string) {
    const activePlans = new Set(plans.filter(plan => plan.goalId === goalId &&
      plan.source === "learning_schedule" && plan.status === "active").map(plan => plan.id));
    return tasks.filter(task => task.goalId === goalId && activePlans.has(task.planId) &&
      task.lessonSource?.route_id === routeId && pending(task));
  }

  private async adjustableTasks(owner: LightTickOwner, route: LearningRoute, tasks: LightTickTaskRow[],
    facts: ScheduleFacts, privateEnabled: boolean, timezone: string, today: string) {
    const byNumber = new Map(facts.map(fact => [fact.number, fact]));
    const candidates = tasks.filter(task => {
      const source = task.lessonSource;
      if (!source || source.route_version !== route.publishedVersion || task.status !== "pending" ||
        task.startedAt || task.actualMinutes != null || task.executionProgress) return false;
      const date = taskBusinessDate(task, timezone);
      if (!date || date <= today) return false;
      const fact = byNumber.get(source.lesson_number);
      return fact?.lessonId === source.lesson_id && fact.contentVersion === source.content_version &&
        (source.purpose === "learn") !== (fact.sourceCompleted || (privateEnabled && fact.completed));
    });
    if (!candidates.length) return [];
    const collection = await this.repo.getLearningCollection(owner, route.id);
    if (!collection || collection.archived) return [];
    const visible: LightTickTaskRow[] = [];
    const lessonById = new Map<string, Awaited<ReturnType<typeof this.repo.getNativeLesson>>>();
    for (const candidate of candidates) {
      const source = candidate.lessonSource!;
      if (!lessonById.has(source.lesson_id)) lessonById.set(source.lesson_id, await this.repo.getNativeLesson(owner, source.lesson_id));
      const lesson = lessonById.get(source.lesson_id);
      if (lesson?.collectionId === route.id && !lesson.archived && lesson.publishedVersion === source.content_version) visible.push(candidate);
    }
    return visible;
  }

  private async reviewReplacements(owner: LightTickOwner, goal: LightTickGoalRow, route: LearningRoute, draft: ManualDraft,
    outstanding: LightTickTaskRow[], facts: ScheduleFacts, privateEnabled: boolean, timezone: string, today: string) {
    const refs = draft.replace_tasks ?? [];
    if (!refs.length) return new Set<string>();
    if (goal.status !== "active") conflict("Resume the goal before changing its course arrangements.");
    const requested = new Set(refs.map(ref => ref.id));
    const candidates = await this.adjustableTasks(owner, route, outstanding.filter(task => requested.has(task.id)),
      facts, privateEnabled, timezone, today);
    const matching = new Map(candidates.map(task => [task.id, task]));
    for (const ref of refs) {
      const task = matching.get(ref.id);
      const date = task && taskBusinessDate(task, timezone);
      if (!task || task.version !== ref.version || !date || date < draft.period_start || date > draft.period_end)
        conflict("A selected course arrangement changed or is no longer adjustable. Review the latest tasks.");
    }
    const used = new Set<string>();
    for (const item of draft.tasks) {
      if (!item.source_task_id) continue;
      const task = matching.get(item.source_task_id);
      if (!task || used.has(task.id) || canonical(task.lessonSource) !== canonical(item.lesson_source))
        invalid("Each selected arrangement must have one edited item for the same lesson version and purpose.");
      if (!item.scheduled_for || item.scheduled_for <= today)
        invalid("Move a selected course arrangement to a date after today's business day.");
      used.add(task.id);
    }
    if (used.size !== refs.length) invalid("Keep one edited lesson for every selected arrangement.");
    return used;
  }

  private async validate(owner: LightTickOwner, goal: LightTickGoalRow, draft: ManualDraft, tasks: LightTickTaskRow[], timezone: string, budget: LearningScheduleBudget) {
    if (!["draft", "active"].includes(goal.status)) conflict("Resume the goal before reviewing new arrangements.");
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
    const outstanding = this.outstandingForRoute(tasks, plans, goal.id, routeId);
    const replaced = await this.reviewReplacements(owner, goal, route, draft, outstanding, facts, authority.privateEnabled, timezone, today);
    const retained = outstanding.filter(task => !replaced.has(task.id));
    const availableBy = (number: number, date: string) => completed.has(number) ||
      draft.tasks.some(item => item.lesson_source?.lesson_number === number && item.lesson_source.purpose === "learn" && item.scheduled_for! <= date) ||
      retained.some(task => task.lessonSource?.lesson_number === number && task.lessonSource.purpose === "learn" &&
        !!task.scheduledFor && taskBusinessDate(task, timezone)! <= date);
    const seen = new Set<string>();
    for (const item of draft.tasks) {
      const source = item.lesson_source!;
      const date = item.scheduled_for!;
      if (date < today) invalid("Schedule lessons from the account's current business day onward.");
      const { publication } = await this.native.publication(owner, source.lesson_id);
      if (publication.contentVersion !== source.content_version) conflict("The lesson body changed. Review a new preview.");
      const identity = source.lesson_id + ":" + source.purpose;
      if (seen.has(identity) || retained.some(task => task.lessonSource?.lesson_id === source.lesson_id && task.lessonSource.purpose === source.purpose)) {
        conflict("This lesson and purpose already have an outstanding arrangement.");
      }
      seen.add(identity);
      if ((source.purpose === "learn") === completed.has(source.lesson_number)) {
        invalid(source.purpose === "learn" ? "This lesson is already complete. Choose review or practice." : "Finish the lesson before arranging review or practice.");
      }
      const lesson = outline.document.lessons[source.lesson_number - 1];
      if (lesson.requires.some(required => !availableBy(required, date))) invalid("Schedule or finish the prerequisite lesson first.");
    }
    const movedPrerequisites = outstanding.filter(task => replaced.has(task.id) && task.lessonSource?.purpose === "learn");
    if (movedPrerequisites.length) {
      const outlines = new Map([[version, outline]]);
      for (const task of retained) {
        const date = taskBusinessDate(task, timezone);
        if (!date) continue;
        const affected = movedPrerequisites.filter(before => taskBusinessDate(before, timezone)! <= date &&
          !availableBy(before.lessonSource!.lesson_number, date));
        if (!affected.length) continue;
        const source = task.lessonSource!;
        const pinned = outlines.get(source.route_version) ??
          await this.repo.learningRoutes.getLearningRouteVersion(owner, routeId, source.route_version);
        if (!pinned) conflict("A retained schedule has an unavailable course version. Review the course first.");
        outlines.set(source.route_version, pinned);
        const spec = pinned.document.lessons[source.lesson_number - 1];
        if (!spec || affected.some(before => spec.requires.includes(before.lessonSource!.lesson_number)))
          conflict("A prerequisite must stay on or before its retained dependent lesson.");
      }
    }
    assertLearningCapacity(goal, budget, draft.tasks, tasks, timezone, replaced);
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
