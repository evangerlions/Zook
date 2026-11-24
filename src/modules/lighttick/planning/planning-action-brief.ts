import { ApplicationError } from "../../../shared/errors.ts";
import type { LightTickPlanRow, LightTickTaskGuidance } from "../lighttick.types.ts";
import { dateOnly } from "../manual/manual-planning.types.ts";
import type { PlanningContext } from "./planning.types.ts";

type ActionBriefTask = {
  title: string;
  scheduled_for?: string;
  completion_criteria?: string;
  steps?: string[];
  guidance?: LightTickTaskGuidance;
};

export function reviewedPlanningMaterials(context: PlanningContext): string[] {
  const materials = context.materials;
  if (!materials || (materials.source !== "confirmed" && materials.source !== "imported") || typeof materials.value !== "string")
    return [];
  return [...new Set(materials.value.split(/\r?\n/u).map(line => line.trim()).filter(Boolean))];
}

export function savedActionBriefConstraints(plan: Pick<LightTickPlanRow, "proposal">, context: PlanningContext) {
  return plan.proposal.action_brief_required === true ? { actionBriefMaterials: reviewedPlanningMaterials(context) } : {};
}

function links(text: string): string[] {
  return [...text.matchAll(/\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>()\[\]{}"'，。；、]+/giu)]
    .map(match => match[0].replace(/[.,!?;:]+$/u, ""));
}

function invalid(message: string): never {
  throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", message);
}

/** The structural task validator also enforces lengths for this normalized model or edit. */
export function assertPlanningActionBrief(task: ActionBriefTask, materialOptions: readonly string[]) {
  if (Object.keys(task).some(key => !["title", "scheduled_for", "estimated_minutes", "priority", "completion_criteria", "steps", "guidance"].includes(key)))
    invalid("Only the reviewed action fields are accepted.");
  const { guidance, steps, completion_criteria } = task;
  if (!dateOnly(task.scheduled_for) || !steps?.length || !completion_criteria || !guidance?.expected_output ||
      !guidance.preparation || !guidance.materials)
    invalid("Each action needs a date, preparation, steps, an observable output, and a completion criterion.");
  const { materials, preparation } = guidance;
  if (new Set(materials).size !== materials.length || materials.some(item => !materialOptions.includes(item)) ||
      (preparation.kind === "provided" ? materials.length === 0 : materials.length !== 0))
    invalid("Use only the exact reviewed material lines or describe a self-contained action.");
  const approvedLinks = new Set(materials.flatMap(links));
  const written = [task.title, completion_criteria, ...steps, guidance.purpose ?? "", guidance.expected_output, preparation.instruction];
  if (written.flatMap(links).some(link => !approvedLinks.has(link)))
    invalid("Use only links in this action's selected materials.");
}
