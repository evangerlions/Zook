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

export type LearningBlockReason =
  | "prerequisite_incomplete"
  | "route_paused"
  | "source_unavailable"
  | "authorization_required";

export function learningReadiness(repository: LightTickRepository, owner: LightTickOwner) {
  const routes = new Map<string, ReturnType<typeof repository.learningRoutes.getLearningRoute>>();
  const outlines = new Map<string, ReturnType<typeof repository.learningRoutes.getLearningRouteVersion>>();
  const completions = new Map<string, ReturnType<typeof completedLearningLessons>>();
  let authority: ReturnType<typeof repository.getLearningAuthority> | undefined;
  return async (task: LightTickTaskRow): Promise<LearningBlockReason | undefined> => {
    const source = task.lessonSource;
    if (!source) return;
    const access = await (authority ??= repository.getLearningAuthority(owner));
    if (!access?.readingEnabled || access.phase !== "zook") return "authorization_required";
    const route = await cached(routes, source.route_id, () =>
      repository.learningRoutes.getLearningRoute(owner, source.route_id));
    if (route?.status === "paused") return "route_paused";
    if (route?.status !== "active") return "source_unavailable";
    const outline = await cached(outlines, source.route_id + ":" + source.route_version, () =>
      repository.learningRoutes.getLearningRouteVersion(owner, source.route_id, source.route_version));
    const spec = outline?.document.lessons[source.lesson_number - 1];
    const lesson = await repository.getNativeLesson(owner, source.lesson_id);
    if (!spec || !lesson?.publishedVersion || lesson.archived || lesson.collectionId !== source.route_id) return "source_unavailable";
    const [collection, publication] = await Promise.all([
      repository.getLearningCollection(owner, lesson.collectionId),
      repository.getLessonPublication(owner, source.lesson_id, source.content_version),
    ]);
    if (!collection || collection.archived || !publication) return "source_unavailable";
    if (!spec.requires.length) return;
    const complete = await cached(completions, source.route_id, () =>
      completedLearningLessons(repository, owner, source.route_id, access.privateEnabled));
    if (spec.requires.some(number => !complete.has(number))) return "prerequisite_incomplete";
  };
}

function cached<T>(map: Map<string, T>, key: string, load: () => T): T {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const value = load();
  map.set(key, value);
  return value;
}

export function rejectBlockedLearning(reason: LearningBlockReason): never {
  switch (reason) {
    case "authorization_required":
      throw new ApplicationError(403, "APP_SCOPE_FORBIDDEN", "Reading consent is required.");
    case "source_unavailable":
      throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "The scheduled lesson source is unavailable.");
    case "route_paused":
      throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Resume the course before executing the arrangement.");
    case "prerequisite_incomplete":
      throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Finish the prerequisite lesson before executing this arrangement.");
  }
}
