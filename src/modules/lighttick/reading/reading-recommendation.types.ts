import type {ArticleContent} from "./reading.types.ts";
import type { ReadingSource } from "./reading-work.types.ts";
import type { ReadingPreferences } from "./reading-preferences.types.ts";
import type { ReadingRecommendationHistory } from "./reading-recommendation.ts";
export type ReadingSelectedSource = Pick<
  ReadingSource,
  | "id"
  | "revision"
  | "title"
  | "url"
  | "format"
  | "language"
  | "topics"
  | "domains"
  | "catalog_id"
>;
export interface ReadingRecommendationScope {
  preferences: ReadingPreferences;
  sources: ReadingSelectedSource[];
  classics?:Omit<ArticleContent,"body">[];
  catalog_revision: string;
  date: string;
  ranking_version: string;
  extraction_version: string;
  seen_count: number;
  digest: string;
}
export interface ReadingRecommendationInput {
  scope: ReadingRecommendationScope;
  seen: string[];
  feedback: ReadingRecommendationHistory[];
  automatic: boolean;
  target_count?: number;
}
