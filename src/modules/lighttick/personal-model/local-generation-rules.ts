import { SCHEDULE_SUGGESTION_SCHEMA } from "../learning/learning-schedule-suggestion.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import { LightTickNativeLearningCourseDocumentSchema } from "../../../generated/openapi/public-contracts.generated.ts";
import { aiGenerationOutputSchema } from "../ai/lighttick-ai-generation.ts";
import { LIGHTTICK_AI_SCENES, LIGHTTICK_SCENE_PROMPTS, LIGHTTICK_SYSTEM_PROMPT } from "../ai/lighttick-ai-scenes.ts";
import { LESSON_OUTPUT_SCHEMA } from "../learning/learning-work-generation.ts";
import { digest } from "../learning/native-learning.validation.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { CLARIFY_SCHEMA } from "../planning/planning-ai-generation.ts";
import type { LocalGenerationContract, LocalGenerationScene } from "./local-generation.types.ts";

type SceneSettings = { modelAlias: string; maxContextTokens: number; maxOutputTokens: number; timeoutMs: number };
export type ResolveLocalScene = (name: LocalGenerationScene) => Promise<SceneSettings>;
// Increment with acceptance changes whose rules are not represented by prompt text or schema.
const acceptanceVersion = 2;

export async function localGenerationRules(
  repository: LightTickRepository, owner: LightTickOwner, name: LocalGenerationScene,
  resolve: ResolveLocalScene, now: string,
) {
  const scene = LIGHTTICK_AI_SCENES[name];
  if (!(scene.tiers as readonly string[]).includes("free")) {
    const subscription = await repository.getUserSubscription?.(owner);
    const tier = subscription?.status === "active" && subscription.currentPeriodEnd > now
      ? ({ basic: "free", premium: "plus", professional: "super_plus", enterprise: "super_plus" } as const)[subscription.planId]
      : "free";
    if (!(scene.tiers as readonly string[]).includes(tier)) {
      throw new ApplicationError(403, "LIGHTTICK_GENERATION_TIER_UNAVAILABLE", "当前套餐未开放此生成场景。");
    }
  }
  const settings = await resolve(name);
  const learning = name.startsWith("learning_");
  const model_requirements = {
    response_format: "json_object" as const,
    max_output_tokens: learning ? Math.min(scene.maxOutputTokens, settings.maxOutputTokens) : settings.maxOutputTokens,
    max_context_tokens: learning ? Math.min(scene.maxContextTokens, settings.maxContextTokens) : settings.maxContextTokens,
    temperature: 0.2,
    timeout_ms: learning ? Math.min(scene.timeoutMs, settings.timeoutMs, 45_000) : settings.timeoutMs,
  };
  if (model_requirements.max_output_tokens > 8192 || model_requirements.timeout_ms > 45000) {
    throw new ApplicationError(503, "LIGHTTICK_GENERATION_RULES_UNAVAILABLE", "当前生成场景的模型限制超出浏览器支持范围。");
  }
  const schemas = { planning_clarify: CLARIFY_SCHEMA, learning_route: LightTickNativeLearningCourseDocumentSchema,
    learning_lesson: LESSON_OUTPUT_SCHEMA, learning_schedule: SCHEDULE_SUGGESTION_SCHEMA };
  const contract = {
    scene: name, scene_key: scene.key, skill_key: scene.key, prompt_version: scene.promptVersion, schema_version: scene.schemaVersion,
    system_prompt: LIGHTTICK_SYSTEM_PROMPT, scene_prompt: LIGHTTICK_SCENE_PROMPTS[name],
    output_schema: name in schemas ? schemas[name as keyof typeof schemas] : aiGenerationOutputSchema(name),
    model_requirements,
  };
  const body: LocalGenerationContract = { ...contract, rules_digest: digest({ contract, settings, acceptanceVersion }) };
  return { body, settings };
}
