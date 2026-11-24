import { ApplicationError } from "../../shared/errors.ts";
import type { LightTickTaskGuidance } from "./lighttick.types.ts";

export const TASK_PREPARATION_MAX_LENGTH = 600;

export interface TaskDetails { completionCriteria?: string; steps?: string[]; guidance?: LightTickTaskGuidance; }
/** One validator for model output and stored draft confirmation. No silent truncation. */
export function validateTaskDetails(details: TaskDetails): void {
  const fail = () => { throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "Task instructions are invalid."); };
  const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
  if (details.completionCriteria !== undefined && !text(details.completionCriteria, 1000)) fail();
  if (details.steps !== undefined && (!Array.isArray(details.steps) || details.steps.length > 12 || details.steps.some(s => !text(s, 1000)))) fail();
  if (details.guidance !== undefined) {
    const g = details.guidance;
    if (!g || typeof g !== "object" || Array.isArray(g) || Object.keys(g).some(k => !["purpose", "materials", "expected_output", "preparation"].includes(k))) fail();
    if (g.purpose !== undefined && !text(g.purpose, 1000)) fail();
    if (g.expected_output !== undefined && !text(g.expected_output, 1000)) fail();
    if (g.materials !== undefined && (!Array.isArray(g.materials) || g.materials.length > 10 || g.materials.some(m => !text(m, 1000)))) fail();
    if (g.preparation !== undefined) {
      const p = g.preparation;
      if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).some(key => !["kind", "instruction"].includes(key)) ||
          !["provided", "self_contained"].includes(p.kind) || !text(p.instruction, TASK_PREPARATION_MAX_LENGTH)) fail();
    }
  }
}
export function taskDetailsFromOutput(task: any): TaskDetails {
  const result = { completionCriteria: task.completion_criteria, steps: task.steps, guidance: task.guidance };
  validateTaskDetails(result); return result;
}
