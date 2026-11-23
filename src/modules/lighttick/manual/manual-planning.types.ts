import { ApplicationError } from "../../../shared/errors.ts";
import type { LightTickTaskLearningTarget } from "../lighttick.types.ts";
export interface ManualAction {
  id: string;
  title: string;
  scheduled_for: string | null;
  estimated_minutes: number | null;
  completion_criteria: string;
  guidance: string;
  source_task_id?: string;
  learning_target?: LightTickTaskLearningTarget;
  lesson_source?: import("../lighttick.types.ts").LightTickLessonSource;
}
export interface ManualDraft {
  goal_id?: string;
  source_reflection_id?: string;
  source_reflection_version?: number;
  replace_tasks?: {id:string;version:number}[];
  resume_goal?: boolean;
  title: string;
  completion_criteria: string;
  period_start: string;
  period_end: string;
  tasks: ManualAction[];
}
export function invalid(message: string): never {
  throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", message);
}
export function dateOnly(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function boundedText(
  value: unknown,
  max: number,
  required = false,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= max &&
    (!required || value.trim().length > 0)
  );
}
/** Structural check of the fixed course source; content/route existence is re-verified at confirm. */
export function learningTarget(value: unknown): LightTickTaskLearningTarget {
  const t = value as LightTickTaskLearningTarget;
  if (
    !t || typeof t !== "object" ||
    t.kind !== "plan" ||
    !boundedText(t.plan_id, 128, true) ||
    !Number.isInteger(t.lesson_no) || t.lesson_no < 1 || t.lesson_no > 10000 ||
    !Number.isInteger(t.route_version) || t.route_version < 1 || t.route_version > 2147483647 ||
    !boundedText(t.lesson_id, 128, true) ||
    typeof t.content_version !== "string" || !/^[a-f0-9]{64}$/.test(t.content_version) ||
    !["learn", "review", "apply"].includes(t.purpose) ||
    Object.keys(t).some(k => !["kind", "plan_id", "lesson_no", "route_version", "lesson_id", "content_version", "purpose"].includes(k))
  )
    invalid("Check the fixed course source, published version and learning purpose.");
  return { kind: "plan", plan_id: t.plan_id, lesson_no: t.lesson_no, route_version: t.route_version,
    lesson_id: t.lesson_id, content_version: t.content_version, purpose: t.purpose };
}
export function validateManualDraft(value: ManualDraft): ManualDraft {
  if (
    !value ||
    !boundedText(value.title, 200, true) ||
    !boundedText(value.completion_criteria, 1000) ||
    !dateOnly(value.period_start) ||
    !dateOnly(value.period_end) ||
    value.period_end < value.period_start ||
    Date.parse(value.period_end) - Date.parse(value.period_start) >
      30 * 86400000
  )
    invalid("Check the goal and a window of at most 31 days.");
  if (
    !Array.isArray(value.tasks) ||
    value.tasks.length < 1 ||
    value.tasks.length > 50
  )
    invalid("A manual plan needs 1–50 actions.");
  const hasSource = value.source_reflection_id !== undefined || value.source_reflection_version !== undefined;
  if (hasSource && (!value.goal_id || typeof value.source_reflection_id !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(value.source_reflection_id) || !Number.isInteger(value.source_reflection_version) || value.source_reflection_version! < 1)) invalid("Select an owned reflection and its reviewed revision.");
  if (value.resume_goal !== undefined && typeof value.resume_goal !== "boolean") invalid("Review whether this arrangement resumes the goal.");
  if (value.replace_tasks !== undefined && (!Array.isArray(value.replace_tasks) || value.replace_tasks.length > 500 || value.replace_tasks.some(r => !r || !boundedText(r.id,128,true) || !Number.isInteger(r.version) || r.version < 1) || new Set(value.replace_tasks.map(r=>r.id)).size !== value.replace_tasks.length)) invalid("Review unique source task IDs and versions.");
  if ((value.resume_goal || value.replace_tasks?.length) && !value.goal_id) invalid("Review the existing goal before replacing or resuming work.");
  const ids = new Set<string>(),
    identities = new Set<string>(),
    learningKeys = new Set<string>(),
    minutes = new Map<string, number>();
  for (const t of value.tasks) {
    if (
      !t ||
      !boundedText(t.id, 128, true) ||
      ids.has(t.id) ||
      !boundedText(t.title, 200, true) ||
      !boundedText(t.completion_criteria, 1000) ||
      !boundedText(t.guidance, 1000)
    )
      invalid("Check each action title, stable ID and instructions.");
    ids.add(t.id);
    if (t.source_task_id !== undefined && !value.replace_tasks?.some(r=>r.id===t.source_task_id)) invalid("Each task source must belong to the reviewed replacement list.");
    if (
      t.scheduled_for !== null &&
      (!dateOnly(t.scheduled_for) ||
        t.scheduled_for < value.period_start ||
        t.scheduled_for > value.period_end)
    )
      invalid("An action date must be valid and within the reviewed window.");
    if (
      t.estimated_minutes !== null &&
      (!Number.isInteger(t.estimated_minutes) ||
        t.estimated_minutes < 1 ||
        t.estimated_minutes > 1440)
    )
      invalid("An estimate must be unknown or 1–1440 minutes.");
    const identity = `${t.title.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()}|${t.scheduled_for ?? "undated"}`;
    if (identities.has(identity)) invalid("Duplicate action on this date.");
    identities.add(identity);
    if (t.learning_target !== undefined) {
      const lt = learningTarget(t.learning_target);
      const key = `${lt.plan_id}|${lt.lesson_no}|${lt.purpose}|${t.scheduled_for ?? "undated"}`;
      if (learningKeys.has(key)) invalid("Duplicate learning arrangement for this lesson, purpose and date.");
      learningKeys.add(key);
    }
    if (t.scheduled_for) {
      const total =
        (minutes.get(t.scheduled_for) ?? 0) + (t.estimated_minutes ?? 0);
      if (total > 1440) invalid("Known daily effort exceeds 1440 minutes.");
      minutes.set(t.scheduled_for, total);
    }
  }
  const {
    goal_id,
    title,
    completion_criteria,
    period_start,
    period_end,
    tasks,
  } = value;
  return {
    ...(goal_id ? { goal_id } : {}),
    ...(hasSource ? {source_reflection_id:value.source_reflection_id,source_reflection_version:value.source_reflection_version} : {}),
    ...(value.replace_tasks ? {replace_tasks:structuredClone(value.replace_tasks)} : {}),
    ...(value.resume_goal !== undefined ? {resume_goal:value.resume_goal} : {}),
    title,
    completion_criteria,
    period_start,
    period_end,
    tasks: structuredClone(tasks).map(a => a.learning_target !== undefined ? { ...a, learning_target: learningTarget(a.learning_target) } : a),
  };
}
