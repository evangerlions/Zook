import { ApplicationError } from "../../../shared/errors.ts";
import { sha256 } from "../../../shared/utils.ts";
import type { LightTickGoalRow, LightTickLessonSource, LightTickOwner, LightTickTaskRow } from "../lighttick.types.ts";
import { businessDateAt } from "../lighttick-today.service.ts";
import type { LightTickTaskService } from "../lighttick-task.service.ts";
import { ManualPlanningService, canonical, manualTaskData } from "../manual/manual-planning.service.ts";
import { invalid, validateManualDraft, type ManualAction, type ManualDraft } from "../manual/manual-planning.types.ts";
import { assertLearningCapacity, taskBusinessDate, type LearningScheduleBudget } from "./learning-schedule-capacity.ts";
import { assertReviewedLearningTimeline, completedLearningLessons, learningReadiness, rejectBlockedLearning } from "./learning-schedule-prerequisites.ts";
import { LearningRouteService } from "./learning-route.service.ts";
import type { NativeLearningService } from "./native-learning.service.ts";

export interface LearningScheduleDraft extends LearningScheduleBudget {
  goal_id: string;
  goal_base_version: number;
  route_id: string;
  route_version: number;
  period_start: string;
  period_end: string;
  replace_tasks?: NonNullable<ManualDraft["replace_tasks"]>;
  items: {
    id: string;
    lesson_number: number;
    purpose: LightTickLessonSource["purpose"];
    scheduled_for: string;
    estimated_minutes: number;
    short_step?: string;
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

export function reviewLearningReplacements(goalId: string, routeId: string, from: string, to: string,
  timezone: string, tasks: LightTickTaskRow[], refs: LearningScheduleDraft["replace_tasks"] = []) {
  return refs.map(ref => {
    const task = tasks.find(item => item.id === ref.id && item.goalId === goalId && item.lessonSource?.route_id === routeId);
    const date = task && taskBusinessDate(task, timezone);
    if (!task || !date || date < from || date > to || !pending(task) || task.version !== ref.version) {
      conflict("A selected learning task changed or is outside the reviewed future window.");
    }
    return task;
  });
}

export class LearningSchedulingService {
  private readonly routes: LearningRouteService;
  private readonly manual: ManualPlanningService;
  constructor(readonly native: NativeLearningService, readonly tasks: LightTickTaskService, authorize: () => Promise<void>) {
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
    return { ...data, route_id: plan.proposal.learning_route_id ?? data.draft.tasks[0]?.lesson_source?.route_id, budget: plan.proposal.learning_budget as unknown as LearningScheduleBudget };
  }

  async get(owner: LightTickOwner, id: string) {
    return this.repo.transaction(owner, async () => {
      await this.access(owner);
      return this.planData(owner, id);
    });
  }

  upcoming(owner: LightTickOwner, goalId: string, routeId: string) {
    return this.repo.transaction(owner, async () => {
      await this.access(owner);
      await this.routes.require(owner, routeId);
      if (!await this.repo.getGoal(owner, goalId)) missing("Goal was not found.");
      const timezone = (await this.repo.getProfile(owner))?.timezone ?? "UTC";
      const today = businessDateAt(this.native.clock(), timezone);
      const tasks = await this.repo.listTasks(owner);
      return { items: tasks.filter(task => task.goalId === goalId && task.lessonSource?.route_id === routeId &&
        pending(task) && (taskBusinessDate(task, timezone) ?? "") > today).map(task => manualTaskData(task, timezone)) };
    });
  }

  draft(owner: LightTickOwner, key: string, input: LearningScheduleDraft) {
    return this.repo.transaction(owner, async () => {
      await this.access(owner);
      return this.manual.operation(owner, key, "learning.schedule.preview", input, () => this.prepare(owner, key, input));
    });
  }

  private async prepare(owner: LightTickOwner, key: string, input: LearningScheduleDraft) {
    const { draft, budget } = await this.review(owner, input);
    const saved = await this.manual.create(owner, "schedule-draft-" + sha256(key).slice(0, 48), draft, { learning_budget: budget, learning_route_id: input.route_id, learning_route_version: input.route_version });
    return { ...saved, budget };
  }

  async review(owner: LightTickOwner, input: LearningScheduleDraft) {
    await this.access(owner, true);
    const goal = await this.repo.getGoal(owner, input.goal_id);
    if (!goal) missing("Goal was not found.");
    if (goal.version !== input.goal_base_version) conflict("The goal changed. Refresh and review the schedule.");
    const route = await this.routes.require(owner, input.route_id);
    if (route.status !== "active" || route.publishedVersion !== input.route_version) conflict("Review the current active course version.");
    const outline = await this.repo.learningRoutes.getLearningRouteVersion(owner, route.id, input.route_version);
    if (!outline) missing("Published course version was not found.");
    const links = await this.repo.learningRoutes.listRouteLessonLinks(owner, route.id);
    const timezone = (await this.repo.getProfile(owner))?.timezone ?? "UTC";
    const tasks = await this.repo.listTasks(owner);
    const businessDate = businessDateAt(this.native.clock(), timezone);
    const replacements = reviewLearningReplacements(goal.id, route.id, input.period_start > businessDate ? input.period_start :
      new Date(Date.parse(businessDate) + 86400000).toISOString().slice(0,10), input.period_end, timezone, tasks, input.replace_tasks);
    const actions: ManualAction[] = [];
    for (const item of input.items) {
      const spec = outline.document.lessons[item.lesson_number - 1];
      const link = links.find(link => link.number === item.lesson_number && link.routeVersion <= input.route_version);
      if (!spec || !link) invalid("Publish this lesson body before scheduling it.");
      const replaced = replacements.find(task => task.lessonSource?.lesson_id === link.lessonId && task.lessonSource.purpose === item.purpose);
      const { publication } = await this.native.publication(owner, link.lessonId, replaced?.lessonSource?.content_version);
      const source: LightTickLessonSource = replaced?.lessonSource ?? {
        route_id: route.id, route_version: input.route_version, lesson_number: item.lesson_number,
        lesson_id: link.lessonId, content_version: publication.contentVersion, purpose: item.purpose,
      };
      actions.push({
        id: item.id, title: (item.purpose === "learn" ? spec.topic : purposeLabel[item.purpose] + " · " + spec.topic).slice(0, 200),
        scheduled_for: item.scheduled_for, estimated_minutes: item.estimated_minutes,
        completion_criteria: spec.assessment.slice(0, 1000), guidance: item.short_step?.trim() || spec.exercise.slice(0, 1000), lesson_source: source,
        ...(replaced ? { source_task_id: replaced.id } : {}),
      });
    }
    const draft: ManualDraft = {
      goal_id: goal.id, title: route.brief.title, completion_criteria: "", period_start: input.period_start,
      period_end: input.period_end, tasks: actions,
      ...(input.replace_tasks?.length ? { replace_tasks: input.replace_tasks } : {}),
    };
    validateManualDraft(draft, true);
    await this.validate(owner, goal, draft, tasks, timezone, input, route.id, input.route_version);
    const budget: LearningScheduleBudget = {
      available_daily_minutes: input.available_daily_minutes, available_weekly_minutes: input.available_weekly_minutes,
    };
    return { draft, budget };
  }

  confirm(owner: LightTickOwner, id: string, key: string, input: { base_version: number; goal_base_version: number }) {
    return this.repo.transaction(owner, async () => {
      // Recheck reading consent even when an accepted receipt exists.
      await this.access(owner);
      const saved = await this.manual.confirm(owner, id, key, input, async (plan, goal, draft, tasks, timezone) => {
        await this.access(owner, true);
        await this.validate(owner, goal, draft, tasks, timezone, plan.proposal.learning_budget as unknown as LearningScheduleBudget,
          (plan.proposal.learning_route_id ?? draft.tasks[0]?.lesson_source?.route_id) as string,
          (plan.proposal.learning_route_version ?? draft.tasks[0]?.lesson_source?.route_version) as number);
        const projection = this.native.courseActions;
        if (projection) {
          const now = this.native.clock();
          for (const task of draft.tasks) {
            const source = task.lesson_source;
            if (source?.purpose !== "learn" || !task.scheduled_for) continue;
            const previous = tasks.find(row => row.id === task.source_task_id)?.lessonSource;
            source.action_id = await projection.arrange(owner, source.route_id, source.lesson_number, task.title,
              task.scheduled_for, timezone, task.estimated_minutes, now, previous?.action_id);
          }
        }
      });
      return { ...saved, budget: (await this.repo.getPlan(owner, id))!.proposal.learning_budget as unknown as LearningScheduleBudget };
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
          if (task.lessonSource?.action_id) await this.native.courseActions?.release(owner, task.lessonSource.action_id, task.scheduledFor, new Date(now));
          await this.repo.saveTask({ ...task, status: "cancelled", updatedAt: now },
            this.manual.write(owner, "task", task.id, task.version + 1, "task_cancel", now, { status: "cancelled" }), task.version);
        }
        await this.repo.savePlan({ ...plan, status: "superseded", updatedAt: now },
          this.manual.write(owner, "plan", id, plan.version + 1, "learning_schedule_stopped", now, { status: "superseded" }), plan.version);
        return this.planData(owner, id);
      });
    });
  }

  private async validate(owner: LightTickOwner, goal: LightTickGoalRow, draft: ManualDraft, tasks: LightTickTaskRow[], timezone: string, budget: LearningScheduleBudget, routeId: string, version: number) {
    const route = await this.routes.require(owner, routeId);
    if (route.status !== "active" || route.publishedVersion !== version) conflict("The course changed. Prepare a new schedule preview.");
    const outline = await this.repo.learningRoutes.getLearningRouteVersion(owner, routeId, version);
    if (!outline) missing("Published course version was not found.");
    const goals = await this.repo.listGoals(owner);
    const active = new Set(goals.filter(item => !["completed", "archived"].includes(item.status)).map(item => item.id));
    const plans = await this.repo.listPlans(owner);
    if (plans.some(plan => {
      if (plan.source !== "learning_schedule" || plan.status !== "active" || !active.has(plan.goalId)) return false;
      const existingRouteId = plan.proposal.learning_route_id ?? (plan.proposal.draft as unknown as ManualDraft).tasks[0]?.lesson_source?.route_id;
      return plan.goalId !== goal.id || existingRouteId !== routeId;
    })) {
      conflict("An existing learning goal and course are active. Review or stop those arrangements first.");
    }
    const authority = await this.access(owner);
    const completed = await completedLearningLessons(this.repo, owner, routeId, authority.privateEnabled);
    const today = businessDateAt(this.native.clock(), timezone);
    const tomorrow = new Date(Date.parse(today) + 86400000).toISOString().slice(0,10);
    const replacements = reviewLearningReplacements(goal.id, routeId, draft.period_start > today ? draft.period_start : tomorrow,
      draft.period_end, timezone, tasks, draft.replace_tasks);
    const originals = new Map(replacements.map(task => [task.id, task]));
    const activePlans = new Set(plans.filter(plan => plan.status === "active").map(plan => plan.id));
    const kept = tasks.filter(task => !originals.has(task.id));
    const seen = new Set<string>();
    for (const item of draft.tasks) {
      const source = item.lesson_source!;
      if (item.scheduled_for! < today) invalid("Schedule lessons from the account's current business day onward.");
      const original = item.source_task_id ? originals.get(item.source_task_id)?.lessonSource : undefined;
      if (item.source_task_id && (!original || canonical(original) !== canonical(source))) {
        conflict("The replacement must retain the original learning source.");
      }
      const { lesson, publication } = await this.native.publication(owner, source.lesson_id, original?.content_version);
      if (publication.contentVersion !== source.content_version) conflict("The lesson body changed. Review a new preview.");
      const identity = source.lesson_id + ":" + source.purpose;
      if (seen.has(identity) || kept.some(task => pending(task) && task.lessonSource?.lesson_id === source.lesson_id && task.lessonSource.purpose === source.purpose)) {
        conflict("This lesson and purpose already have an outstanding arrangement.");
      }
      seen.add(identity);
      const completedSource = completed.has(source.lesson_number) || (
        original && authority.privateEnabled && lesson.publishedVersion !== source.content_version &&
        (await this.native.privateState(owner, source.lesson_id, source.content_version)).completed
      );
      if ((source.purpose === "learn") === Boolean(completedSource)) {
        invalid(source.purpose === "learn" ? "This lesson is already complete. Choose review or practice." : "Finish the lesson before arranging review or practice.");
      }
    }
    const outstanding = kept.filter(task => pending(task) && activePlans.has(task.planId) && task.lessonSource?.route_id === routeId);
    await assertReviewedLearningTimeline(this.repo, owner, draft.tasks, outstanding, replacements, completed, timezone);
    const replaceIds = new Set(originals.keys());
    assertLearningCapacity(goal, budget, draft.tasks, tasks, timezone, replaceIds);
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
    const goal = await this.repo.getGoal(owner, task.goalId);
    const plan = await this.repo.getPlan(owner, task.planId);
    if (goal?.status !== "active" || plan?.status !== "active") {
      conflict("Resume the goal before executing the arrangement.");
    }
    const reason = await learningReadiness(this.repo, owner)(task);
    if (reason) rejectBlockedLearning(reason);
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
        if (task.version !== input.base_version || !pending(task) || source.purpose !== "learn" ||
            source.lesson_id !== input.lesson_id || source.content_version !== input.content_version) {
          conflict("The assignment or lesson version changed. Refresh and review before completing.");
        }
        await this.assertReady(owner, task);
        const previous = await this.native.privateState(owner, source.lesson_id, source.content_version);
        if (previous.completionRevision !== input.completion_base_revision) conflict("Lesson completion changed. Refresh and review.");
        const learning = previous.completed ? { completed: true, completion_revision: previous.completionRevision } :
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
