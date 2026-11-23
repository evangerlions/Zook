import type { LLMCompletionRequest } from "../../../services/llm-manager-types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { assembleChatContext, assembleLightTickContext } from "./lighttick-ai-context.ts";
import { LIGHTTICK_OUTPUT_SCHEMAS, LIGHTTICK_SCENE_PROMPTS, LIGHTTICK_SYSTEM_PROMPT, type LightTickAiSceneName } from "./lighttick-ai-scenes.ts";
import { parseLightTickJson, validatePlanOutput, validateProposalOutput, validateReadingGuideOutput, validateReviewOutput } from "./lighttick-ai-validation.ts";
import { NEXT_WEEK_ADVICE_SCHEMA, type NextWeekContext, validateNextWeekAdvice } from "../next-week-advice.ts";

type AiContext = Awaited<ReturnType<typeof assembleChatContext> | ReturnType<typeof assembleLightTickContext>>;
type PreparedAiGeneration = Awaited<ReturnType<typeof prepareAiGeneration>>;

export async function prepareAiGeneration(repository: LightTickRepository, owner: LightTickOwner,
  sceneName: LightTickAiSceneName, input: Record<string, unknown>, scene: { modelAlias: string; maxOutputTokens: number }, clock: () => Date) {
  if (sceneName === "next_week_advice")
    throw new ApplicationError(400, "REQ_FIELD_INVALID", "Use the reviewed weekly evidence for this scene.");
  const { model_selection: _modelSelection, browser_generation_id: _browserAttempt, ...intent } = input;
  const context = sceneName === "coach_chat"
    ? await assembleChatContext(repository, owner, intent, String(intent.thread_id ?? intent.goal_id ?? "default"))
    : await assembleLightTickContext(repository, owner, intent);
  const schema = aiGenerationOutputSchema(sceneName);
  const constraints = constraintInstructions(sceneName, context, clock);
  // PostgreSQL JSONB may reorder request fields before the worker reads them.
  const contextJson = JSON.stringify(context, (_key, value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const fields = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(fields).sort().map(key => [key, fields[key]]));
  });
  const request: LLMCompletionRequest = {
    modelKey: scene.modelAlias,
    messages: [
      { role: "system", content: LIGHTTICK_SYSTEM_PROMPT },
      { role: "user", content: `${LIGHTTICK_SCENE_PROMPTS[sceneName]}\nOUTPUT_JSON_SCHEMA=${JSON.stringify(schema)}\n` +
        `${constraints}\nReturn one compact JSON object that matches this schema exactly. Do not use Markdown fences or add prose.\n` +
        `INPUT_JSON=${contextJson}` },
    ],
    temperature: 0.2,
    maxTokens: scene.maxOutputTokens,
  };
  return { sceneName, context, schema, request };
}

export function prepareNextWeekGeneration(context: NextWeekContext,
  scene: { modelAlias: string; maxOutputTokens: number; maxContextTokens: number; timeoutMs: number }) {
  const approved = {
    goal: context.goal_title, period_start: context.period_start, period_end: context.period_end,
    next_period_start: context.next_period_start, next_period_end: context.next_period_end,
    ...(context.target_date ? { target_date: context.target_date } : {}),
    facts: context.facts, availability: context.availability,
    carry_sources: context.carry_sources.map(({ id, evidence_ids, remaining_estimated_minutes }) =>
      ({ id, evidence_ids, remaining_estimated_minutes })),
    ...(context.source ? { selected_reflection_excerpt: context.source.excerpt } : {}),
  };
  const userPrompt = `${LIGHTTICK_SCENE_PROMPTS.next_week_advice}\nOUTPUT_JSON_SCHEMA=${JSON.stringify(NEXT_WEEK_ADVICE_SCHEMA)}\n` +
    `INPUT_JSON=${JSON.stringify(approved)}`;
  if (Buffer.byteLength(LIGHTTICK_SYSTEM_PROMPT + userPrompt) > Math.min(scene.maxContextTokens, 10_000))
    throw new ApplicationError(422, "LIGHTTICK_AI_RUN_FAILED", "Choose a shorter review window or excerpt.");
  const request: LLMCompletionRequest = {
    modelKey: scene.modelAlias,
    messages: [{ role: "system", content: LIGHTTICK_SYSTEM_PROMPT }, { role: "user", content: userPrompt }],
    temperature: 0.2,
    maxTokens: Math.min(1500, scene.maxOutputTokens),
    signal: AbortSignal.timeout(Math.min(20_000, scene.timeoutMs)),
  };
  return { request, validate: (output: string) => validateNextWeekAdvice(parseLightTickJson(output), context) };
}

export function validateAiGeneration(
  prepared: Pick<PreparedAiGeneration, "sceneName" | "context">,
  response: string | Record<string, unknown>,
  clock: () => Date,
) {
  const output = typeof response === "string" ? parseLightTickJson(response) : response;
  const { sceneName: scene, context } = prepared;
  if (["onboarding_plan", "month_plan", "week_plan", "day_plan"].includes(scene)) {
    if ((!context.request.period_start || !context.request.period_end) &&
      Array.isArray(output.tasks) && output.tasks.some((task: any) => task?.scheduled_for !== undefined))
      throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "Scheduling requires an explicit period.");
    return validatePlanOutput(output, planConstraints(context, clock));
  }
  if (["daily_review", "weekly_review", "monthly_review"].includes(scene)) return validateReviewOutput(output);
  if (scene === "change_proposal") return validateProposalOutput(output, new Set("tasks" in context ? context.tasks.map(task => task.id) : []));
  if (scene === "reading_guide") {
    // 没有文章就没有导读可写，直接判失败，不产出「成功但无资源」的空跑。
    if (!("article" in context) || !context.article) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Reading article was not found.");
    return validateReadingGuideOutput(output, context.article.authoritative_basis);
  }
  if (typeof output.message !== "string" || output.message.length > 2000)
    throw new ApplicationError(502, "LIGHTTICK_AI_RUN_FAILED", "Coach output does not match its schema.");
  return output;
}

export function aiGenerationOutputSchema(scene: LightTickAiSceneName) {
  if (["onboarding_plan", "month_plan", "week_plan", "day_plan"].includes(scene)) return LIGHTTICK_OUTPUT_SCHEMAS.plan;
  if (["daily_review", "weekly_review", "monthly_review"].includes(scene)) return LIGHTTICK_OUTPUT_SCHEMAS.review;
  if (scene === "change_proposal") return LIGHTTICK_OUTPUT_SCHEMAS.change_proposal;
  if (scene === "next_week_advice") return NEXT_WEEK_ADVICE_SCHEMA;
  if (scene === "reading_guide") return LIGHTTICK_OUTPUT_SCHEMAS.reading_guide;
  return LIGHTTICK_OUTPUT_SCHEMAS.coach_reply;
}

function constraintInstructions(scene: LightTickAiSceneName, context: AiContext, clock: () => Date): string {
  if (scene === "reading_guide")
    return "article" in context && context.article?.body_truncated
      ? "ARTICLE_CONSTRAINTS: The article body was cut off and you only received its opening portion. Set basis to summary and state in evidence_limits that the later part of the article was not available."
      : "ARTICLE_CONSTRAINTS: Use only the supplied article. Do not add outside knowledge.";
  if (!["onboarding_plan", "month_plan", "week_plan", "day_plan"].includes(scene))
    return "Use only IDs and facts present in INPUT_JSON.";
  const { availableMinutes } = planConstraints(context, clock);
  const periodStart = typeof context.request.period_start === "string" ? context.request.period_start : undefined;
  const periodEnd = typeof context.request.period_end === "string" ? context.request.period_end : undefined;
  const scheduling = periodStart && periodEnd
    ? `If scheduled_for is present, its date must be from ${periodStart} through ${periodEnd} inclusive.`
    : "Omit scheduled_for from every task because no requested period_start/period_end was supplied.";
  return `PLAN_CONSTRAINTS: The sum of estimated_minutes must be at most ${availableMinutes}. ${scheduling}`;
}

function planConstraints(context: AiContext, clock: () => Date) {
  const availableMinutes = planAvailableMinutes(context);
  const periodStart = String(context.request.period_start ?? clock().toISOString().slice(0, 10));
  const periodEnd = String(context.request.period_end ?? periodStart);
  for (const date of [periodStart, periodEnd]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date)
      throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "A valid planning period is required.");
  }
  if (periodEnd < periodStart)
    throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "Planning period ends before it starts.");
  return { availableMinutes, periodStart, periodEnd };
}

function planAvailableMinutes(context: AiContext): number {
  const minutes = Number(context.request.available_minutes ?? context.request.weekly_available_minutes ??
    context.goal?.constraints?.weekly_available_minutes ?? 300);
  if (!Number.isFinite(minutes) || minutes < 1)
    throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "A positive available time budget is required.");
  return minutes;
}

export function aiGenerationFallback(policy: string, input: Record<string, unknown>, prepared: PreparedAiGeneration) {
  const { context } = prepared;
  if (policy === "facts_only" && input.coach_scene) return {
    message: "AI 暂时不可用。你可以先查看当前目标、计划和执行事实，稍后安全重试。",
    source: "facts_only", scene: input.coach_scene,
  };
  if (policy === "facts_only") return { insights: [], recommendations: [], source: "facts_only" };
  if (policy === "template") return { tasks: [{ title: "Review goal and choose the next smallest step",
    estimated_minutes: Math.min(30, Math.floor(planAvailableMinutes(context))), priority: 100 }], source: "deterministic_template" };
  return undefined;
}
