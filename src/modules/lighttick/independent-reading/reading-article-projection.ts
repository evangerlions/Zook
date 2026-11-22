import { hasReadingFeedback } from "./reading-feedback.ts";
import type { ReadingArticle, ReadingCatalogEntry } from "./reading.types.ts";
/** A preview is a projection, never a replacement body under the original digest. */
export function readingCatalogEntry(row: ReadingArticle): ReadingCatalogEntry {
  return {
    id: row.id,
    revision: row.revision,
    content_version: row.content_version,
    title: row.content.title,
    preview: Array.from(row.content.body).slice(0, 160).join(""),
    language: row.content.language,
    source_url: row.content.source_url,
    published_at: row.content.published_at,
    published_date: row.content.published_date ?? null,
    archived: row.archived,
    bookmark: row.personal.bookmark,
    later: row.personal.later,
    read: row.personal.read,
    has_feedback: hasReadingFeedback(row),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
