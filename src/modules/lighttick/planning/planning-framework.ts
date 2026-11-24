import { ApplicationError } from "../../../shared/errors.ts";
import { dateOnly } from "../manual/manual-planning.types.ts";

const limits = { stages: 6, title: 120, criteria: 400, rationale: 600, note: 400, materials: 5, material: 180 };
const stringSchema = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });
const optionalDateSchema = { anyOf: [{ type: "string", format: "date" }, { type: "null" }] };

export const PLANNING_FRAMEWORK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rationale", "stages"],
  properties: {
    rationale: stringSchema(limits.rationale),
    budget_note: stringSchema(limits.note),
    missing_materials: { type: "array", maxItems: limits.materials, items: stringSchema(limits.material) },
    stages: {
      type: "array", minItems: 1, maxItems: limits.stages,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "outcome_criteria", "starts_on", "ends_on"],
        properties: {
          title: stringSchema(limits.title),
          outcome_criteria: stringSchema(limits.criteria),
          starts_on: optionalDateSchema,
          ends_on: optionalDateSchema,
        },
      },
    },
  },
};

export interface PlanningFrameworkLimits {
  periodStart: string;
  periodEnd: string;
  targetDate?: string;
}

function invalid(): never {
  throw new ApplicationError(422, "LIGHTTICK_AI_UNAVAILABLE", "The proposed stages do not match the reviewed planning scope.");
}

function record(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key))) invalid();
  return value as Record<string, unknown>;
}

function bounded(value: unknown, limit: number) {
  if (typeof value !== "string" || !value.trim() || value.length > limit) invalid();
  return value.trim();
}

function stageDates(start: unknown, end: unknown, earliest: string, latest: string) {
  if (start === null && end === null) return { starts_on: null, ends_on: null };
  if (!dateOnly(start) || !dateOnly(end) || start < earliest || start > end || end > latest) invalid();
  return { starts_on: start, ends_on: end };
}

export function validatePlanningFramework(value: unknown, { periodStart, periodEnd, targetDate }: PlanningFrameworkLimits) {
  const framework = record(value, ["rationale", "stages", "budget_note", "missing_materials"]);
  const latest = dateOnly(targetDate) ? targetDate : periodEnd;
  if (!Array.isArray(framework.stages) || framework.stages.length < 1 || framework.stages.length > limits.stages) invalid();
  const stages = framework.stages.map(raw => {
    const stage = record(raw, ["title", "outcome_criteria", "starts_on", "ends_on"]);
    return {
      title: bounded(stage.title, limits.title),
      outcome_criteria: bounded(stage.outcome_criteria, limits.criteria),
      ...stageDates(stage.starts_on, stage.ends_on, periodStart, latest),
    };
  });
  const keys = stages.map(stage => stage.title.normalize("NFKC").toLowerCase().replace(/\s+/g, " "));
  if (new Set(keys).size !== keys.length) invalid();
  const dates = stages.flatMap(stage => stage.starts_on ? [stage.starts_on] : []);
  if (dates.some((date, index) => index > 0 && date < dates[index - 1]!)) invalid();

  const { missing_materials: missing, budget_note: note } = framework;
  if (missing !== undefined && (!Array.isArray(missing) || missing.length > limits.materials)) invalid();
  return {
    rationale: bounded(framework.rationale, limits.rationale),
    stages,
    ...(note !== undefined ? { budget_note: bounded(note, limits.note) } : {}),
    missing_materials: missing?.map(item => bounded(item, limits.material)) ?? [],
  };
}
