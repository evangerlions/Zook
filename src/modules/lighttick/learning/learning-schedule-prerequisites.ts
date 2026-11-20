import { ApplicationError } from "../../../shared/errors.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner, LightTickTaskRow } from "../lighttick.types.ts";
import { taskBusinessDate } from "./learning-schedule-capacity.ts";

export async function completedLearningLessons(
  repository: LightTickRepository, owner: LightTickOwner, routeId: string, privateEnabled: boolean,
) {
  const facts = await repository.learningRoutes.readRouteProgressFacts(owner, routeId);
  return new Set(facts.filter(fact => fact.sourceCompleted || (privateEnabled && fact.completed)).map(fact => fact.number));
}

export async function assertLearningReschedulePrerequisites(
  repository: LightTickRepository, owner: LightTickOwner, current: LightTickTaskRow,
  date: string, tasks: LightTickTaskRow[], timezone: string,
) {
  const source = current.lessonSource!;
  const authority = await repository.getLearningAuthority(owner);
  if (!authority?.readingEnabled || authority.phase !== "zook") {
    throw new ApplicationError(403, "APP_SCOPE_FORBIDDEN", "Reading consent is required to reschedule this lesson.");
  }
  const completed = await completedLearningLessons(repository, owner, source.route_id, authority.privateEnabled);
  const activePlans = new Set((await repository.listPlans(owner)).filter(plan => plan.status === "active").map(plan => plan.id));
  const outstanding = tasks.filter(task => activePlans.has(task.planId) &&
    ["pending", "in_progress"].includes(task.status) && task.lessonSource?.route_id === source.route_id);
  const versionCache = new Map<number, Awaited<ReturnType<typeof repository.learningRoutes.getLearningRouteVersion>>>();
  async function prerequisites(task: LightTickTaskRow) {
    const pinned = task.lessonSource!;
    if (!versionCache.has(pinned.route_version)) {
      versionCache.set(pinned.route_version, await repository.learningRoutes.getLearningRouteVersion(owner, pinned.route_id, pinned.route_version));
    }
    const lesson = versionCache.get(pinned.route_version)?.document.lessons[pinned.lesson_number - 1];
    if (!lesson) throw new ApplicationError(409, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "The scheduled course version is no longer available.");
    return lesson.requires;
  }
  function availableBy(number: number, deadline: string) {
    return completed.has(number) || outstanding.some(task => {
      const lesson = task.lessonSource!;
      const scheduled = task.id === current.id ? date : taskBusinessDate(task, timezone);
      return lesson.purpose === "learn" && lesson.lesson_number === number && scheduled !== null && scheduled <= deadline;
    });
  }
  const missingUpstream = (await prerequisites(current)).some(number => !availableBy(number, date));
  if (missingUpstream) {
    throw new ApplicationError(409, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "Schedule or finish the prerequisite lesson first.");
  }
  if (source.purpose !== "learn" || completed.has(source.lesson_number)) return;
  for (const task of outstanding) {
    if (task.id === current.id) continue;
    const scheduled = taskBusinessDate(task, timezone);
    if (scheduled && scheduled < date && (await prerequisites(task)).includes(source.lesson_number) &&
      !availableBy(source.lesson_number, scheduled)) {
      throw new ApplicationError(409, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "The prerequisite must stay on or before its dependent lesson.");
    }
  }
}
