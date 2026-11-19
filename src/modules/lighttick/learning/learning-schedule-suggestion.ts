import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats, { type FormatsPlugin } from "ajv-formats";
import {
  LightTickLearningScheduleSuggestionSchema,
  LightTickLearningScheduleDraftSchema,
  type LightTickLearningScheduleSuggestion,
} from "../../../generated/openapi/public-contracts.generated.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { LightTickTaskService } from "../lighttick-task.service.ts";
import { businessDateAt } from "../lighttick-today.service.ts";
import { fail } from "./native-learning.validation.ts";
import { LearningSchedulingService, type LearningScheduleDraft } from "./learning-scheduling.service.ts";
import { taskBusinessDate } from "./learning-schedule-capacity.ts";
import { routeProgress } from "./learning-route.progress.ts";
import type { LearningRoute } from "./learning-route.types.ts";
import type { LearningWork } from "./learning-work.types.ts";
import type { NativeLearningService } from "./native-learning.service.ts";

const ajv = new Ajv2020({ strict: false });
(addFormats as unknown as FormatsPlugin)(ajv);
const acceptsRequest = ajv.compile<LightTickLearningScheduleSuggestion>(LightTickLearningScheduleSuggestionSchema);
type ModelOutput = { items: Omit<LearningScheduleDraft["items"][number], "id">[] };
const { id: _id, ...itemProperties } = LightTickLearningScheduleDraftSchema.properties.items.items.properties;
export const SCHEDULE_SUGGESTION_SCHEMA = {
  type: "object", additionalProperties: false, required: ["items"],
  properties: { items: {
    type: "array", maxItems: 12,
    items: { type: "object", additionalProperties: false, required: Object.keys(itemProperties), properties: itemProperties },
  } },
} as const;
const acceptsOutput = ajv.compile<ModelOutput>(SCHEDULE_SUGGESTION_SCHEMA);
type Options = LightTickLearningScheduleSuggestion & { route_id: string; route_version: number };

export async function prepareScheduleSuggestion(native: NativeLearningService, owner: LightTickOwner, route: LearningRoute | undefined, request: unknown) {
  if (!acceptsRequest(request)) fail(422, "Check the goal, scheduling dates and available minutes.");
  if (!route?.publishedVersion || route.status !== "active") fail(409, "Activate a published course before proposing dates.");
  if (!(await native.requireActive(owner)).privateEnabled) fail(403, "Private learning consent is required for AI scheduling.");
  const repo = native.repository;
  const goal = await repo.getGoal(owner, request.goal_id);
  if (!goal || goal.version !== request.goal_base_version || !["draft", "active"].includes(goal.status)) {
    fail(409, "Review the current goal before proposing dates.");
  }
  const timezone = (await repo.getProfile(owner))?.timezone ?? "UTC";
  const businessDate = businessDateAt(native.clock(), timezone);
  const duration = Date.parse(request.period_end) - Date.parse(request.period_start);
  if (request.period_start < businessDate || duration < 0 || duration > 30 * 86_400_000) {
    fail(422, "Choose a window up to 31 days starting on or after the current business day.");
  }
  const progress = await routeProgress(native, owner, route.id);
  const outline = await repo.learningRoutes.getLearningRouteVersion(owner, route.id, route.publishedVersion);
  if (!outline) fail(404, "Published route version was not found.");
  const relevant = (await repo.listTasks(owner)).filter(task => task.goalId === goal.id &&
    ["pending", "in_progress", "completed"].includes(task.status));
  const pendingLessons = new Set(relevant.filter(t => t.status !== "completed").flatMap(t =>
    t.lessonSource && t.lessonSource.route_id === route.id ? [t.lessonSource.lesson_number] : []));
  const candidates = progress.lessons.filter(lesson => lesson.lesson_id && lesson.content_version && !pendingLessons.has(lesson.number))
    .sort((a, b) => Number(a.completed) - Number(b.completed) || a.number - b.number)
    .slice(0, 32);
  const catalog = [];
  for (const lesson of candidates) {
    const body = await repo.getNativeLesson(owner, lesson.lesson_id!);
    if (!body || body.archived || body.publishedVersion !== lesson.content_version) continue;
    const spec = outline.document.lessons[lesson.number - 1];
    catalog.push({
        number: lesson.number, topic: spec.topic.slice(0, 160), requires: lesson.requires,
        completed: lesson.completed, suggested_minutes: spec.minutes, content_version: lesson.content_version!,
    });
    if (catalog.length === 16) break;
  }
  if (!catalog.length) fail(422, "Publish a lesson body or review the existing arrangements first.");
  const occupied: Record<string, { minutes: number; needs_estimate: boolean }> = {};
  for (const task of relevant) {
    const date = taskBusinessDate(task, timezone);
    if (!date || Date.parse(date) < Date.parse(request.period_start) - 6 * 86_400_000 ||
        Date.parse(date) > Date.parse(request.period_end) + 6 * 86_400_000) continue;
    const tally = occupied[date] ??= { minutes: 0, needs_estimate: false };
    const minutes = task.status === "completed" ? task.actualMinutes ?? task.estimatedMinutes : task.estimatedMinutes;
    if (minutes === null) tally.needs_estimate = true;
    else tally.minutes += minutes;
  }
  const options: Options = { ...request, route_id: route.id, route_version: route.publishedVersion };
  const weeklyLimit = goal.constraints.weekly_available_minutes;
  return { options, goal_title: goal.title, catalog, occupied, business_date: businessDate,
    planned_ratio: 0.8, ...(typeof weeklyLimit === "number" ? { goal_available_weekly_minutes: weeklyLimit } : {}) };
}
type Prepared = Awaited<ReturnType<typeof prepareScheduleSuggestion>>;

export function parseScheduleSuggestion(work: LearningWork, raw: unknown) {
  if (!acceptsOutput(raw)) fail(422, "The model did not return a valid schedule suggestion.");
  const prepared = work.input.schedule as Prepared;
  const allowed = new Set(prepared.catalog.map(lesson => lesson.number));
  if (raw.items.some(item => !allowed.has(item.lesson_number))) fail(422, "The model referenced a lesson outside the reviewed course material.");
  const suggestion: LearningScheduleDraft = {
    ...prepared.options,
    items: raw.items.map(item => ({ ...item, id: work.id + "-" + item.lesson_number + "-" + item.purpose })),
  };
  return { suggestion };
}

export async function validateScheduleSuggestion(native: NativeLearningService, work: LearningWork, output: Record<string, unknown>) {
  const suggestion = output.suggestion as LearningScheduleDraft;
  const goal = await native.repository.getGoal(work, suggestion.goal_id);
  if (!goal || goal.version !== suggestion.goal_base_version || !["draft", "active"].includes(goal.status)) {
    fail(409, "The reviewed goal changed while the model was working.");
  }
  if (!suggestion.items.length) return;
  const scheduling = new LearningSchedulingService(native, new LightTickTaskService(native.repository, native.clock), async () => {});
  await scheduling.review(work, suggestion);
}
