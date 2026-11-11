import type { ArticleContent } from "./reading.types.ts";
export interface ReadingCandidate {
  id: string;
  content: Omit<ArticleContent, "body">;
  excerpt: string;
  source_id: string | null;
  source_revision: number | null;
}
