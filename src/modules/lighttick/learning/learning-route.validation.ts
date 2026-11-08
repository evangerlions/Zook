import { text, integer, object, keys, fail } from "./native-learning.validation.ts";
import type { CourseBrief, CourseDocument } from "./learning-route.types.ts";
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
      assessment: text(s.assessment, 1000, true), minutes: integer(s.minutes, 5, brief.minutes), stage: integer(s.stage, 1, stages.length),
      kind: s.kind as "lesson" | "review", requires: [...new Set(requires as number[])].sort((a, b) => a - b) };
  });
  if (!lessons.some(l => l.kind === "review") || brief.pacing === "self_paced" && lessons.at(-1)!.kind !== "review") fail(422, "Course must include review; self-paced courses end with review.");
  return { prerequisites: text(d.prerequisites, 4000, true), stages, lessons };
}
