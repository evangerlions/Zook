import { canonical, text, identity, integer, object, keys, fail, version } from "./native-learning.validation.ts";
import type { CourseBrief, CourseDocument, CourseLessonSpec, RouteRefinementObservationSource } from "./learning-route.types.ts";
export function courseBrief(input: unknown): CourseBrief {
  const b = object(input);
  keys(b, ["title", "goal", "level", "minutes", "pacing", "weeks", "sessions", "lesson_count"]);
  const base = { title: text(b.title, 4000, true), goal: text(b.goal, 4000, true), level: text(b.level, 4000, true), minutes: integer(b.minutes, 5, 120) };
  if (b.pacing === "self_paced") return { ...base, pacing: "self_paced", lesson_count: integer(b.lesson_count, 2, 364) };
  if (b.pacing !== "weekly" && b.pacing !== undefined) fail(422, "Unknown course pacing.");
  return { ...base, pacing: "weekly", weeks: integer(b.weeks, 1, 52), sessions: integer(b.sessions, 1, 7) };
}
export function courseLessonCount(b: CourseBrief) { return b.pacing === "self_paced" ? b.lesson_count! : b.weeks! * b.sessions!; }
export function courseDocument(input: unknown, brief: CourseBrief): CourseDocument {
  const d = object(input); keys(d, ["prerequisites", "stages", "lessons"]);
  const count = courseLessonCount(brief), maxStages = brief.pacing === "weekly" ? brief.weeks! : count;
  if (!Array.isArray(d.stages) || !d.stages.length || d.stages.length > maxStages) fail(422, "Stage count exceeds the course schedule.");
  const stages = d.stages.map((v: unknown) => {
    const s = object(v); keys(s, ["title", "goal"]);
    return { title: text(s.title, 4000, true), goal: text(s.goal, 4000, true) };
  });
  if (!Array.isArray(d.lessons) || d.lessons.length !== count) fail(422, "Lesson count must match the confirmed course conditions.");
  const lessons = d.lessons.map((v: unknown, index: number) => {
    const s = object(v); keys(s, ["number", "topic", "goal", "exercise", "assessment", "minutes", "stage", "kind", "requires"]);
    if (s.number !== index + 1 || !["lesson", "review"].includes(s.kind)) fail(422, "Lesson order or type is invalid.");
    const requires = s.requires ?? [];
    if (!Array.isArray(requires) || requires.some((n: unknown) => !Number.isInteger(n) || Number(n) < 1 || Number(n) >= s.number)) fail(422, "Prerequisites must refer only to earlier lessons.");
    return { number: s.number, topic: text(s.topic, 1000, true), goal: text(s.goal, 1000, true), exercise: text(s.exercise, 1000, true),
      // 课节时长下限钳到 brief 的 70%：实测蓝图会把 15 分钟课写成 10 分钟，
      // 课节随后按 10 分钟生成并核算 6.7/10「通过」，门的判定基准跟着蓝图一起漂移。
      // 这里钳到 [ceil(minutes*0.7), minutes]，低于下限的设计一律按接近 brief 的时长生成。
      assessment: text(s.assessment, 1000, true), minutes: Math.min(brief.minutes, Math.max(Math.ceil(brief.minutes * 0.7), integer(s.minutes, 5, brief.minutes))), stage: integer(s.stage, 1, stages.length),
      kind: s.kind as "lesson" | "review", requires: [...new Set(requires as number[])].sort((a, b) => a - b) };
  });
  if (!lessons.some(l => l.kind === "review") || brief.pacing === "self_paced" && lessons.at(-1)!.kind !== "review") fail(422, "Course must include review; self-paced courses end with review.");
  return { prerequisites: text(d.prerequisites, 4000, true), stages, lessons };
}
export interface RouteFeedbackIssue { area: string; note: string }
export interface RouteFeedback {
  rating?: number;
  focus: string;
  issues: RouteFeedbackIssue[];
  keep: string[];
  note: string;
}
/** Structured, bounded feedback used to regenerate an unpublished part of a course. */
export function routeFeedback(input: unknown, observationIncluded = false): RouteFeedback {
  const value = input === undefined ? {} : object(input);
  keys(value, ["rating", "focus", "issues", "keep", "note"]);
  const rating = value.rating === undefined ? undefined : integer(value.rating, 1, 5);
  const focus = text(value.focus ?? "", 1000).trim(), note = text(value.note ?? "", 4000).trim();
  const rawIssues = value.issues === undefined ? [] : value.issues;
  const rawKeep = value.keep === undefined ? [] : value.keep;
  if (!Array.isArray(rawIssues) || rawIssues.length > 8) fail(422, "At most eight feedback issues are supported.");
  if (!Array.isArray(rawKeep) || rawKeep.length > 20) fail(422, "At most twenty keep items are supported.");
  const issues = rawIssues.map((entry: unknown) => {
    const issue = object(entry);
    keys(issue, ["area", "note"]);
    return { area: text(issue.area, 100, true), note: text(issue.note ?? "", 500) };
  });
  const keep = rawKeep.map((entry: unknown) => text(entry, 200, true));
  if (!observationIncluded && rating === undefined && !focus && !issues.length && !keep.length && !note)
    fail(422, "Provide feedback before refining the course.");
  return { ...(rating === undefined ? {} : { rating }), focus, issues, keep, note };
}

export function routeRefinementObservation(input: unknown): RouteRefinementObservationSource | undefined {
  if (input === undefined) return;
  const source = object(input);
  keys(source, ["lesson_id", "content_version", "observation_revision", "goal_id"]);
  return {
    lesson_id: identity(source.lesson_id, "lesson-"), content_version: version(source.content_version),
    observation_revision: integer(source.observation_revision, 1, 2147483646),
    goal_id: source.goal_id === null ? null : identity(source.goal_id),
  };
}

export function assertRefinementPreservesStages(previous: CourseDocument, proposed: CourseDocument,
  frozen: CourseLessonSpec[], status: 409 | 422) {
  for (const stage of new Set(frozen.map(lesson => lesson.stage))) {
    if (canonical(previous.stages[stage - 1]) !== canonical(proposed.stages[stage - 1]))
      fail(status, "A stage containing already published lessons must remain unchanged.");
  }
}
