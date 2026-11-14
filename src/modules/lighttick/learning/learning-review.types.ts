import type { LightTickOwner } from "../lighttick.types.ts";
export interface LearningCompletion {
  lesson_id: string;
  content_version: string;
  title: string;
  module: string;
  module_label: string;
  completed_at: string | null;
  available: boolean;
  is_current: boolean;
}
export interface LearningReviewRepository {
  listLearningCompletions(
    owner: LightTickOwner,
    includePrivate: boolean,
  ): Promise<LearningCompletion[]>;
}
