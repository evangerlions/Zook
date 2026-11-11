import { readingSearchText } from "./reading-feedback.ts";
import type { ReadingArticle } from "./reading.types.ts";
export interface ReadingReviewProjection {
  id: string;
  revision: number;
  content_version: string;
  title: string;
  excerpt: string;
  created_at: string;
  read: boolean;
  read_at: string | null;
}
export function readingReviewProjection(
  row: ReadingArticle,
  query: string,
): ReadingReviewProjection {
  const text = query ? readingSearchText(row) : row.content.body,
    index = query ? text.toLowerCase().indexOf(query.toLowerCase()) : 0;
  const position = index < 0 ? 0 : Array.from(text.slice(0, index)).length,
    start = Math.max(0, position - 100);
  return {
    id: row.id,
    revision: row.revision,
    content_version: row.content_version,
    title: row.content.title,
    excerpt: Array.from(text)
      .slice(start, start + 500)
      .join(""),
    created_at: row.created_at,
    read: row.personal.read,
    read_at: row.personal.read_at,
  };
}
