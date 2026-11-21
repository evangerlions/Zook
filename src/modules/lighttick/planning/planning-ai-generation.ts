import type { LLMCompletionRequest } from "../../../services/llm-manager-types.ts";
import { LIGHTTICK_OUTPUT_SCHEMAS, type LightTickAiSceneName } from "../ai/lighttick-ai-scenes.ts";
import { LIGHTTICK_SCENE_PROMPTS, LIGHTTICK_SYSTEM_PROMPT } from "../ai/lighttick-ai-prompts.ts";
import { parseLightTickJson, validatePlanOutput } from "../ai/lighttick-ai-validation.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickAiRunRow, LightTickOwner } from "../lighttick.types.ts";
import { planningError, text, validField } from "./planning-context.ts";
import type { PlanningSession } from "./planning.types.ts";

const CLARIFY_SCHEMA = { type: "object", required: ["message", "fields"], additionalProperties: false, properties: {
  message: { type: "string", maxLength: 2000 }, fields: { type: "object", additionalProperties: false, properties:
    Object.fromEntries(["objective","outcome","experience","available_minutes","period_start","period_end","constraints"].map(key=>[key, key === "available_minutes" ? { type:"integer",minimum:1,maximum:10080 } : { type:"string",maxLength:1000 }])) },
} };

export async function preparePlanningGeneration(
  repository: LightTickRepository,
  owner: LightTickOwner,
  run: LightTickAiRunRow,
  scene: { modelAlias: string; maxContextTokens: number; maxOutputTokens: number },
) {
  const clarify = run.inputContext.planning_action === "messages";
  const name: LightTickAiSceneName = clarify ? "planning_clarify" : "week_plan";
  const input = structuredClone(run.inputContext) as Record<string, unknown> & { conversation?: unknown[] };
  input.existing_tasks = (await repository.listTasks(owner)).filter(t => t.goalId === input.goal_id && t.status !== "cancelled")
    .slice(-100).map(t => ({ title: t.title, date: t.scheduledFor, status: t.status, estimated_minutes: t.estimatedMinutes }));
  delete input.model_selection; delete input.planning_session_id; delete input.snapshot;
  const context = input.context as PlanningSession["context"];
  const schema = clarify ? CLARIFY_SCHEMA : LIGHTTICK_OUTPUT_SCHEMAS.plan;
  const constraints = clarify ? "Fields are candidate assumptions requiring user review; message must ask at most two questions."
    : `PLAN_CONSTRAINTS: Existing tasks remain active; do not duplicate them. total estimated_minutes at most ${context.available_minutes!.value}; scheduled_for must be from ${context.period_start!.value} through ${context.period_end!.value}.`;
  const prefix = `${LIGHTTICK_SCENE_PROMPTS[name]}\nOUTPUT_JSON_SCHEMA=${JSON.stringify(schema)}\n${constraints}\nINPUT_JSON=`;
  while (Buffer.byteLength(LIGHTTICK_SYSTEM_PROMPT + prefix + JSON.stringify(input)) > scene.maxContextTokens && input.conversation?.length) input.conversation.shift();
  if (Buffer.byteLength(LIGHTTICK_SYSTEM_PROMPT + prefix + JSON.stringify(input)) > scene.maxContextTokens)
    planningError(422,"LIGHTTICK_PLANNING_CONTEXT_TOO_LARGE","Shorten the context before retrying.");
  const request: LLMCompletionRequest = {
    modelKey: scene.modelAlias,
    messages: [{ role: "system", content: LIGHTTICK_SYSTEM_PROMPT }, { role: "user", content: prefix + JSON.stringify(input) }],
    maxTokens: scene.maxOutputTokens,
    temperature: 0.2,
  };
  return { clarify, context, request, schema };
}

export function validatePlanningGeneration(prepared: Awaited<ReturnType<typeof preparePlanningGeneration>>, response: string) {
  const { clarify, context } = prepared;
  const output = parseLightTickJson(response);
  if (clarify) {
    text(output.message);
    if (!output.fields || typeof output.fields !== "object" || Array.isArray(output.fields)) throw new Error("fields");
    for (const [key, value] of Object.entries(output.fields)) validField(key, value);
  } else {
    validatePlanOutput(output, {
      availableMinutes: Number(context.available_minutes!.value),
      periodStart: String(context.period_start!.value),
      periodEnd: String(context.period_end!.value),
    });
  }
  return output;
}
