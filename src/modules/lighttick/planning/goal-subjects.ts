import { ApplicationError } from "../../../shared/errors.ts";
import type { LightTickGoalRow, LightTickPlanRow } from "../lighttick.types.ts";

export const GOAL_SUBJECTS_KEY = "goal_planning_subjects";
const subjectIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const priorityValues = new Set(["high", "normal", "low"]);
const maxSubjects = 30;
export const maxPriorSubjectOutcomes = 10;

export interface GoalSubjectDefinition {
  id: string;
  title: string;
  outcome_criteria: string;
  priority: "high" | "normal" | "low";
  weekly_minutes: number | null;
  archived: boolean;
}

export interface GoalSubjectOutcome {
  note: string;
  recorded_at: string;
  task_id?: string;
}

export interface GoalSubject extends GoalSubjectDefinition {
  latest_outcome: GoalSubjectOutcome | null;
  outcome_history?: GoalSubjectOutcome[];
}

interface StoredSubjects {
  schema_version: 1;
  version: number;
  subjects: GoalSubject[];
}

const definitionFields = ["id", "title", "outcome_criteria", "priority", "weekly_minutes", "archived"];
const objectOf = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

export function validGoalSubjectId(value: unknown): value is string {
  return typeof value === "string" && subjectIdPattern.test(value);
}

function subjectDefinition(value: Record<string, unknown>): GoalSubjectDefinition | undefined {
  const { id, priority, weekly_minutes, archived } = value;
  const title = typeof value.title === "string" && value.title.length <= 200 ? value.title.trim() : "";
  const outcome_criteria = typeof value.outcome_criteria === "string" && value.outcome_criteria.length <= 1000 ?
    value.outcome_criteria.trim() : "";
  if (!validGoalSubjectId(id) || !title || !outcome_criteria || typeof priority !== "string" ||
    !priorityValues.has(priority) || typeof archived !== "boolean" ||
    (weekly_minutes !== null && (typeof weekly_minutes !== "number" || !Number.isInteger(weekly_minutes) ||
      weekly_minutes < 0 || weekly_minutes > 10080))) return undefined;
  return { id, title, outcome_criteria, priority: priority as GoalSubjectDefinition["priority"], weekly_minutes, archived };
}

function validOutcome(input: unknown): input is GoalSubjectOutcome {
  const value = objectOf(input);
  return !!value && Object.keys(value).every(key => ["note", "recorded_at", "task_id"].includes(key)) &&
    typeof value.note === "string" && value.note.trim().length > 0 && value.note.length <= 2000 &&
    typeof value.recorded_at === "string" && Number.isFinite(Date.parse(value.recorded_at)) &&
    (value.task_id === undefined || validGoalSubjectId(value.task_id));
}

function validSubject(input: unknown): input is GoalSubject {
  const value = objectOf(input);
  if (!value || !Object.keys(value).every(key => [...definitionFields, "latest_outcome", "outcome_history"].includes(key)) ||
    !subjectDefinition(value) || (value.latest_outcome !== null && !validOutcome(value.latest_outcome))) return false;
  return value.outcome_history === undefined || (value.latest_outcome !== null &&
    Array.isArray(value.outcome_history) && value.outcome_history.length <= maxPriorSubjectOutcomes &&
    value.outcome_history.every(validOutcome));
}

export function readGoalSubjects(goal: LightTickGoalRow): StoredSubjects {
  const stored = goal.constraints[GOAL_SUBJECTS_KEY];
  if (stored === undefined) return { schema_version: 1, version: 0, subjects: [] };
  const state = objectOf(stored);
  if (!state || state.schema_version !== 1 || typeof state.version !== "number" || !Number.isSafeInteger(state.version) ||
    state.version < 1 || !Array.isArray(state.subjects) || state.subjects.length > maxSubjects ||
    !state.subjects.every(validSubject) || new Set(state.subjects.map(subject => subject.id)).size !== state.subjects.length) {
    throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Review the saved subject definitions before continuing.");
  }
  return { schema_version: 1, version: state.version, subjects: structuredClone(state.subjects) };
}

export function normalizeGoalSubjects(input: unknown): GoalSubjectDefinition[] {
  if (!Array.isArray(input) || input.length > maxSubjects)
    throw new ApplicationError(400, "REQ_FIELD_INVALID", "A goal supports at most 30 subjects.");
  const known = new Set<string>();
  return input.map(item => {
    const value = objectOf(item);
    const subject = value && Object.keys(value).length === definitionFields.length &&
      definitionFields.every(key => Object.hasOwn(value, key)) && subjectDefinition(value);
    if (!subject || known.has(subject.id))
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "Give each subject a unique ID, title, outcome, priority and optional weekly limit.");
    known.add(subject.id);
    return subject;
  });
}

export function findGoalSubject(goal: LightTickGoalRow, subjectId: string): GoalSubject | undefined {
  return readGoalSubjects(goal).subjects.find(subject => subject.id === subjectId);
}

export function assertSubjectPlacement(goal: LightTickGoalRow, subjectId: string): GoalSubject {
  const subject = findGoalSubject(goal, subjectId);
  if (!subject || subject.archived)
    throw new ApplicationError(409, "LIGHTTICK_PLANNING_SUBJECT_UNAVAILABLE", "Choose an available subject for this goal.");
  return subject;
}

export function subjectIdForPlan(plan: LightTickPlanRow): string | undefined {
  if (validGoalSubjectId(plan.proposal.subject_id)) return plan.proposal.subject_id;
  const draft = objectOf(plan.proposal.draft);
  return validGoalSubjectId(draft?.subject_id) ? draft.subject_id : undefined;
}
