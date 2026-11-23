import { LightTickNativeLearningCourseDocumentSchema } from "../../../generated/openapi/public-contracts.generated.ts";
import type { CourseBrief } from "./learning-route.types.ts";
import { courseLessonCount } from "./learning-route.validation.ts";

/** Tighten the generated contract to the confirmed schedule; the public contract is unchanged. */
export function courseGenerationContext(brief: CourseBrief) {
  const count = courseLessonCount(brief);
  const maxStages = brief.pacing === "weekly" ? brief.weeks! : count;
  const schema = structuredClone(LightTickNativeLearningCourseDocumentSchema) as any;
  schema.properties.lessons.minItems = count;
  schema.properties.lessons.maxItems = count;
  schema.properties.stages.maxItems = maxStages;
  schema.properties.lessons.items.properties.number.maximum = count;
  schema.properties.lessons.items.properties.stage.maximum = maxStages;
  schema.properties.lessons.items.properties.minutes.maximum = brief.minutes;
  return {
    schema,
    constraints: {
      lesson_count: count,
      lesson_numbers: Array.from({ length: count }, (_, i) => i + 1),
      max_stages: maxStages,
      min_lesson_minutes: 5,
      max_lesson_minutes: brief.minutes,
      review_required: true,
      final_lesson_must_review: brief.pacing === "self_paced",
    },
  };
}
