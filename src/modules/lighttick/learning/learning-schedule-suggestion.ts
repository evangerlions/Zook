import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats, { type FormatsPlugin } from "ajv-formats";
import { LightTickLearningScheduleSuggestionSchema, type LightTickLearningScheduleSuggestion } from "../../../generated/openapi/public-contracts.generated.ts";
import type { LightTickLessonSource, LightTickOwner } from "../lighttick.types.ts";
import { LightTickTaskService } from "../lighttick-task.service.ts";
import { businessDateAt } from "../lighttick-today.service.ts";
import { taskAwaitingExternalInput, taskHasTransferredRemainingWork, taskRemainingEstimate } from "../lighttick-task-progress.ts";
import { taskBusinessDate } from "./learning-schedule-capacity.ts";
import { LearningSchedulingService, type LearningScheduleDraft } from "./learning-scheduling.service.ts";
import { routeProgress } from "./learning-route.progress.ts";
import type { LearningRoute } from "./learning-route.types.ts";
import type { LearningWork } from "./learning-work.types.ts";
import type { NativeLearningService } from "./native-learning.service.ts";
import { fail } from "./native-learning.validation.ts";

const ajv = new Ajv2020({ strict: false });
(addFormats as unknown as FormatsPlugin)(ajv);
const acceptsRequest = ajv.compile<LightTickLearningScheduleSuggestion>(LightTickLearningScheduleSuggestionSchema);
const day = 86_400_000;
const maxItems = 12;

type SuggestionItem = {
  lesson_number: number;
  purpose: LightTickLessonSource["purpose"];
  scheduled_for: string;
  estimated_minutes: number;
};
type SelectedScheduleTask = Pick<SuggestionItem, "lesson_number" | "purpose" | "scheduled_for"> & {
  source_task_id: string;
  content_version: string;
  estimated_minutes: number | null;
};

export const SCHEDULE_SUGGESTION_OUTPUT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["items"],
  properties: { items: { type: "array", maxItems, items: {
    type: "object", additionalProperties: false,
    required: ["lesson_number", "purpose", "scheduled_for", "estimated_minutes"],
    properties: {
      lesson_number: { type: "integer", minimum: 1, maximum: 364 },
      purpose: { type: "string", enum: ["learn", "review", "apply"] },
      scheduled_for: { type: "string", format: "date" },
      estimated_minutes: { type: "integer", minimum: 1, maximum: 1440 },
    },
  } } },
};
const acceptsOutput = ajv.compile<{ items: SuggestionItem[] }>(SCHEDULE_SUGGESTION_OUTPUT_SCHEMA);

const readScheduling = (native: NativeLearningService) =>
  new LearningSchedulingService(native, new LightTickTaskService(native.repository, native.clock), async () => {});
const identity = (item: Pick<SuggestionItem, "lesson_number" | "purpose">) => `${item.lesson_number}/${item.purpose}`;

export async function prepareScheduleSuggestion(native: NativeLearningService, owner: LightTickOwner, route: LearningRoute | undefined, request: unknown) {
  if (!acceptsRequest(request)) fail(422, "Check the goal, schedule dates and available minutes.");
  if (!route?.publishedVersion || route.status !== "active") fail(409, "Activate a published course before proposing dates.");
  const authority = await native.requireActive(owner);
  if (!authority.privateEnabled) fail(403, "Private learning consent is required for AI scheduling.");
  const repo = native.repository;
  const goal = await repo.getGoal(owner, request.goal_id);
  if (!goal || goal.version !== request.goal_base_version || !["draft", "active"].includes(goal.status))
    fail(409, "Review the current goal before proposing dates.");
  const timezone = (await repo.getProfile(owner))?.timezone ?? "UTC";
  const businessDate = businessDateAt(native.clock(), timezone);
  const duration = Date.parse(request.period_end) - Date.parse(request.period_start);
  if (request.period_start < businessDate || duration < 0 || duration > 30 * day)
    fail(422, "Choose a window up to 31 days within the current or future business dates.");

  const outline = await repo.learningRoutes.getLearningRouteVersion(owner, route.id, route.publishedVersion);
  if (!outline) fail(404, "Published course version was not found.");
  const progress = await routeProgress(native, owner, route.id);
  const relevant = (await repo.listTasks(owner)).filter(task => task.goalId === goal.id &&
    ["pending", "in_progress", "completed"].includes(task.status));
  const selected: SelectedScheduleTask[] = [];
  if (request.replace_tasks?.length) {
    const upcoming = await readScheduling(native).upcoming(owner, goal.id, route.id);
    for (const reference of request.replace_tasks) {
      const task = upcoming.items.find(row => row.id === reference.id && row.version === reference.version);
      if (!task?.lesson_source || !task.scheduled_date || task.scheduled_date < request.period_start || task.scheduled_date > request.period_end)
        fail(409, "Review the current future learning tasks before requesting an adjustment.");
      const source = task.lesson_source;
      selected.push({
        lesson_number: source.lesson_number, purpose: source.purpose, source_task_id: task.id,
        content_version: source.content_version, scheduled_for: task.scheduled_date, estimated_minutes: task.estimated_duration_minutes,
      });
    }
  }
  const replacements = new Set(selected.map(task => task.source_task_id));
  const kept = relevant.filter(task => !replacements.has(task.id));
  const pending = new Set(kept.flatMap(task => task.status !== "completed" && task.lessonSource?.route_id === route.id
    ? [identity(task.lessonSource)] : []));
  const choicesByLesson = progress.lessons.flatMap(lesson => {
    if (!lesson.lesson_id || !lesson.content_version) return [];
    const pinned = selected.filter(task => task.lesson_number === lesson.number && task.content_version === lesson.content_version);
    const choices = selected.length ? pinned : [{
      lesson_number: lesson.number, purpose: lesson.completed ? "review" as const : "learn" as const,
      scheduled_for: null, estimated_minutes: null,
    }];
    return choices.filter(item => !pending.has(identity(item))).map(({ lesson_number, purpose, scheduled_for, estimated_minutes }) => ({
      lesson_number, purpose, scheduled_for, estimated_minutes, content_version: lesson.content_version!,
      topic: outline.document.lessons[lesson.number - 1].topic.slice(0, 160),
      requires: lesson.requires, suggested_minutes: outline.document.lessons[lesson.number - 1].minutes,
    }));
  }).slice(0, 16);
  if (!choicesByLesson.length || (selected.length > 0 && choicesByLesson.length !== selected.length))
    fail(422, "Review the published course lessons or update the existing arrangements first.");

  const pins = Object.fromEntries(choicesByLesson.map(choice => [identity(choice), choice.content_version]));
  const catalog = choicesByLesson.map(({ content_version, ...choice }) => choice);

  const occupied: Record<string, { minutes: number; needs_estimate: boolean }> = {};
  for (const task of kept) {
    if (task.status !== "completed" && (taskAwaitingExternalInput(task) || taskHasTransferredRemainingWork(task))) continue;
    const date = taskBusinessDate(task, timezone);
    if (!date || Date.parse(date) < Date.parse(request.period_start) - 6 * day ||
      Date.parse(date) > Date.parse(request.period_end) + 6 * day) continue;
    const tally = occupied[date] ??= { minutes: 0, needs_estimate: false };
    const minutes = task.status === "completed" ? task.actualMinutes ?? task.estimatedMinutes : taskRemainingEstimate(task);
    if (minutes == null) tally.needs_estimate = true;
    else tally.minutes += minutes;
  }
  return {
    options: { ...request, route_id: route.id, route_version: route.publishedVersion },
    selected,
    pins,
    modelInput: {
      catalog, occupied, business_date: businessDate, editing_selected_tasks: selected.length > 0,
      goal_title: goal.title.slice(0, 160),
      period_start: request.period_start, period_end: request.period_end,
      available_daily_minutes: request.available_daily_minutes, available_weekly_minutes: request.available_weekly_minutes,
      planned_ratio: 0.8,
      ...(typeof goal.constraints.weekly_available_minutes === "number"
        ? { goal_available_weekly_minutes: goal.constraints.weekly_available_minutes } : {}),
    },
  };
}

type PreparedSchedule = Awaited<ReturnType<typeof prepareScheduleSuggestion>>;

export function parseScheduleSuggestion(work: LearningWork, raw: unknown) {
  if (!acceptsOutput(raw)) fail(422, "The model did not return a valid schedule suggestion.");
  if (!raw.items.length) return { no_change: true };
  const prepared = work.input.schedule as PreparedSchedule;
  const allowed = new Set(prepared.modelInput.catalog.map(identity));
  const keys = new Set(raw.items.map(identity));
  if (keys.size !== raw.items.length || [...keys].some(key => !allowed.has(key)) ||
    (prepared.selected.length > 0 && prepared.selected.length !== keys.size)) {
    fail(422, "The suggestion must cover each selected lesson exactly once and stay within the reviewed course.");
  }
  const suggestion: LearningScheduleDraft = {
    ...prepared.options,
    items: raw.items.map(item => {
      const selected = prepared.selected.find(task => identity(task) === identity(item));
      return { ...item, id: `${work.id}-${item.lesson_number}-${item.purpose}`,
        ...(selected ? { source_task_id: selected.source_task_id } : {}) };
    }),
  };
  return { suggestion };
}

export async function scheduleSuggestionCurrent(native: NativeLearningService, work: LearningWork) {
  const schedule = work.input.schedule as PreparedSchedule;
  const repo = native.repository;
  const goal = await repo.getGoal(work, schedule.options.goal_id);
  if (!goal || goal.version !== schedule.options.goal_base_version || !["draft", "active"].includes(goal.status)) return false;
  for (const reference of schedule.options.replace_tasks ?? []) {
    const task = await repo.getTask(work, reference.id);
    if (!task || task.version !== reference.version || task.status !== "pending") return false;
  }
  return true;
}

export async function validateScheduleSuggestion(native: NativeLearningService, work: LearningWork, output: Record<string, unknown>) {
  if (output.no_change === true) return;
  const { draft } = await readScheduling(native).review(work, output.suggestion as LearningScheduleDraft);
  const { pins } = work.input.schedule as PreparedSchedule;
  if (draft.tasks.some(item => !item.lesson_source || pins[identity(item.lesson_source)] !== item.lesson_source.content_version)) {
    fail(409, "A selected lesson's publication changed while the schedule suggestion was being prepared.");
  }
}
