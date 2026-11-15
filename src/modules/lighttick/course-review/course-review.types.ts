import type { LightTickOwner } from "../lighttick.types.ts";
export interface CourseFeedback {
  lesson_id: string;
  content_version: string;
  revision: number;
  mastery_level:
    | "fully_understood"
    | "basically_understood"
    | "partially_understood"
    | "not_understood";
  value_rating: number;
  feeling_tags: string[];
  key_learnings: string;
  questions: string;
  next_direction: string;
  updated_at: string;
}
export interface CourseReviewStore {
  list(o: LightTickOwner, collection: string): Promise<CourseFeedback[]>;
  save(
    o: LightTickOwner,
    collection: string,
    row: CourseFeedback,
    base: number,
  ): Promise<void>;
}
export const privateLearningWork = (w: {
  kind: string;
  input: Record<string, any>;
}) => w.kind === "course_summary" || !!w.input.course_review_context;
