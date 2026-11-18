import { LIGHTTICK_PROMPT_VERSION } from "./lighttick-ai-prompts.ts";
export { LIGHTTICK_SYSTEM_PROMPT, LIGHTTICK_SCENE_PROMPTS } from "./lighttick-ai-prompts.ts";

export const LIGHTTICK_AI_SCENES = {
  learning_route: { key: "lighttick.learning_route.v1", kind: "course", promptVersion: LIGHTTICK_PROMPT_VERSION, schemaVersion: "1.0.0",
    modelAlias: "novel-structured", tiers: ["free", "plus", "super_plus"], timeoutMs: 90_000, maxContextTokens: 24_000,
    maxOutputTokens: 8_000, maxEstimatedCostUsd: 0.25, fallback: "none" },
  learning_lesson: { key: "lighttick.learning_lesson.v1", kind: "course", promptVersion: LIGHTTICK_PROMPT_VERSION, schemaVersion: "1.0.0",
    modelAlias: "novel-structured", tiers: ["free", "plus", "super_plus"], timeoutMs: 30_000, maxContextTokens: 20_000,
    maxOutputTokens: 4_000, maxEstimatedCostUsd: 0.15, fallback: "none" },
  // 汇报练习反馈不做模板兜底：没有模型就不给反馈，也不假装检查过。
  // maxContextTokens 会被 runner 用「字节数」比较，而提交稿上限是 18000 字节，这里留足余量。
  learning_practice_review: { key: "lighttick.learning_practice_review.v1", kind: "review", promptVersion: LIGHTTICK_PROMPT_VERSION, schemaVersion: "1.0.0",
    modelAlias: "novel-structured", tiers: ["free", "plus", "super_plus"], timeoutMs: 30_000, maxContextTokens: 32_000,
    maxOutputTokens: 3_000, maxEstimatedCostUsd: 0.10, fallback: "none" },
  onboarding_plan: { key: "lighttick.onboarding_plan.v1", kind: "onboarding_plan", promptVersion: LIGHTTICK_PROMPT_VERSION, schemaVersion: "1.0.0",
    modelAlias: "novel-structured", tiers: ["free", "plus", "super_plus"], timeoutMs: 25_000, maxContextTokens: 8_000,
    maxOutputTokens: 3_000, maxEstimatedCostUsd: 0.08, fallback: "template" },
  month_plan: { key: "lighttick.month_plan.v1", kind: "plan", promptVersion: LIGHTTICK_PROMPT_VERSION, schemaVersion: "1.0.0",
    modelAlias: "novel-structured", tiers: ["free", "plus", "super_plus"], timeoutMs: 30_000, maxContextTokens: 10_000,
    maxOutputTokens: 4_000, maxEstimatedCostUsd: 0.12, fallback: "template" },
  week_plan: { key: "lighttick.week_plan.v1", kind: "plan", promptVersion: LIGHTTICK_PROMPT_VERSION, schemaVersion: "1.0.0",
    modelAlias: "novel-structured", tiers: ["free", "plus", "super_plus"], timeoutMs: 25_000, maxContextTokens: 8_000,
    maxOutputTokens: 3_000, maxEstimatedCostUsd: 0.08, fallback: "template" },
  day_plan: { key: "lighttick.day_plan.v1", kind: "plan", promptVersion: LIGHTTICK_PROMPT_VERSION, schemaVersion: "1.0.0",
    modelAlias: "novel-structured", tiers: ["free", "plus", "super_plus"], timeoutMs: 20_000, maxContextTokens: 6_000,
    maxOutputTokens: 2_000, maxEstimatedCostUsd: 0.05, fallback: "template" },
  weekly_review: { key: "lighttick.weekly_review.v1", kind: "review", promptVersion: LIGHTTICK_PROMPT_VERSION, schemaVersion: "1.0.0",
    modelAlias: "novel-structured", tiers: ["free", "plus", "super_plus"], timeoutMs: 20_000, maxContextTokens: 8_000,
    maxOutputTokens: 2_000, maxEstimatedCostUsd: 0.05, fallback: "facts_only" },
  monthly_review: { key: "lighttick.monthly_review.v1", kind: "review", promptVersion: LIGHTTICK_PROMPT_VERSION, schemaVersion: "1.0.0",
    modelAlias: "novel-structured", tiers: ["free", "plus", "super_plus"], timeoutMs: 25_000, maxContextTokens: 10_000,
    maxOutputTokens: 3_000, maxEstimatedCostUsd: 0.08, fallback: "facts_only" },
  daily_review: { key: "lighttick.daily_review.v1", kind: "review", promptVersion: LIGHTTICK_PROMPT_VERSION, schemaVersion: "1.0.0",
    modelAlias: "novel-structured", tiers: ["free", "plus", "super_plus"], timeoutMs: 15_000, maxContextTokens: 6_000,
    maxOutputTokens: 1_400, maxEstimatedCostUsd: 0.03, fallback: "facts_only" },
  change_proposal: { key: "lighttick.change_proposal.v1", kind: "change_proposal", promptVersion: LIGHTTICK_PROMPT_VERSION, schemaVersion: "1.0.0",
    modelAlias: "novel-structured", tiers: ["plus", "super_plus"], timeoutMs: 25_000, maxContextTokens: 8_000,
    maxOutputTokens: 2_500, maxEstimatedCostUsd: 0.08, fallback: "none" },
  coach_reply: { key: "lighttick.coach_reply.v1", kind: "coach_reply", promptVersion: LIGHTTICK_PROMPT_VERSION, schemaVersion: "1.0.0",
    modelAlias: "novel-structured", tiers: ["plus", "super_plus"], timeoutMs: 15_000, maxContextTokens: 4_000,
    maxOutputTokens: 800, maxEstimatedCostUsd: 0.03, fallback: "facts_only" },
  coach_chat: { key: "lighttick.coach_chat.v1", kind: "coach_reply", promptVersion: LIGHTTICK_PROMPT_VERSION, schemaVersion: "1.0.0",
    modelAlias: "novel-structured", tiers: ["plus", "super_plus"], timeoutMs: 20_000, maxContextTokens: 6_000,
    maxOutputTokens: 800, maxEstimatedCostUsd: 0.04, fallback: "facts_only" },
  planning_clarify: { key: "lighttick.planning_clarify.v1", kind: "coach_reply", promptVersion: LIGHTTICK_PROMPT_VERSION, schemaVersion: "1.0.0",
    modelAlias: "novel-structured", tiers: ["plus", "super_plus"], timeoutMs: 20_000, maxContextTokens: 8_000,
    maxOutputTokens: 2_000, maxEstimatedCostUsd: 0.04, fallback: "none" },
  // 阅读导读不做模板兜底：没有模型就不生成，界面上写「还没有导读」比给一份假导读诚实。
  reading_guide: { key: "lighttick.reading_guide.v1", kind: "reading_guide", promptVersion: LIGHTTICK_PROMPT_VERSION, schemaVersion: "1.0.0",
    modelAlias: "novel-structured", tiers: ["free", "plus", "super_plus"], timeoutMs: 25_000, maxContextTokens: 10_000,
    maxOutputTokens: 2_500, maxEstimatedCostUsd: 0.06, fallback: "none" },
} as const;

export type LightTickAiSceneName = keyof typeof LIGHTTICK_AI_SCENES;

export const LIGHTTICK_OUTPUT_SCHEMAS = {
  plan: { type: "object", required: ["tasks"], properties: { summary: {type:"string",maxLength:2000}, assumptions:{type:"array",maxItems:10,items:{type:"string",maxLength:500}}, tasks: { type: "array", minItems: 1, maxItems: 50,
    items: { type: "object", required: ["title", "estimated_minutes"], properties: { title: { type: "string" },
      estimated_minutes: { type: "integer", minimum: 1, maximum: 1440 }, priority: { type: "integer" }, scheduled_for: { type: "string" },
      completion_criteria: { type: "string", maxLength: 1000 },
      steps: { type: "array", maxItems: 12, items: { type: "string", maxLength: 1000 } },
      guidance: { type: "object", additionalProperties: false, properties: {
        purpose: { type: "string", maxLength: 1000 }, expected_output: { type: "string", maxLength: 1000 },
        materials: { type: "array", maxItems: 10, items: { type: "string", maxLength: 1000 } } } } } } } } },
  review: { type: "object", required: ["insights", "recommendations"], properties: { insights: { type: "array", maxItems: 10 },
    recommendations: { type: "array", maxItems: 10 } } },
  change_proposal: { type: "object", required: ["diff", "impact"], properties: { diff: { type: "array", maxItems: 50 }, impact: { type: "object" } } },
  coach_reply: { type: "object", required: ["message"], properties: { message: { type: "string", maxLength: 2000 } } },
  // basis 是「导读据以生成的依据」，不是模型的自由发挥：服务端只允许往保守方向纠正。
  reading_guide: { type: "object", required: ["basis", "core_points", "evidence_limits", "language_notes", "application_questions"],
    properties: {
      basis: { type: "string", enum: ["full_text", "summary"] },
      core_points: { type: "array", minItems: 1, maxItems: 6, items: { type: "string", maxLength: 400 } },
      evidence_limits: { type: "array", maxItems: 5, items: { type: "string", maxLength: 400 } },
      language_notes: { type: "array", maxItems: 6, items: { type: "string", maxLength: 400 } },
      application_questions: { type: "array", minItems: 1, maxItems: 5, items: { type: "string", maxLength: 300 } },
    } },
} as const;
