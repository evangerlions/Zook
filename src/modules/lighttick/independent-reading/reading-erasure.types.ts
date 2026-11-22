import { articleContent } from "./reading.validation.ts";
import { digest } from "../learning/native-learning.validation.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { ReadingArticle } from "./reading.types.ts";
import type { ReadingWork } from "./reading-work.types.ts";
export interface ReadingTombstone {
  id: string;
  revision: number;
  content_version: string;
  deleted: true;
  deleted_at: string;
}
export interface ReadingErasureTargets {
  article_id: string;
  work_ids: string[];
  vocabulary_ids: string[];
}
export interface ReadingErasureRepository {
  versionCount(o: LightTickOwner, id: string): Promise<number>;
  contentTombstone(
    o: LightTickOwner,
    version: string,
  ): Promise<ReadingTombstone | undefined>;
  tombstone(
    o: LightTickOwner,
    id: string,
  ): Promise<ReadingTombstone | undefined>;
  related(o: LightTickOwner, article: ReadingArticle): Promise<ReadingWork[]>;
  receipts(
    o: LightTickOwner,
    targets: ReadingErasureTargets,
  ): Promise<{ operation_id: string; payload_hash: string }[]>;
  erase(
    o: LightTickOwner,
    tombstone: ReadingTombstone,
    targets: ReadingErasureTargets,
  ): Promise<void>;
}
export function relatedReadingWork(row: ReadingWork, article: ReadingArticle) {
  return (
    row.id === article.provenance?.work_id ||
    row.input.article_id === article.id ||
    (!!article.content.source_url &&
      row.input.url === article.content.source_url) ||
    Object.values(row.adopted).some((r) => r.article_id === article.id) ||
    row.output?.entry_refs?.some(
      (r) => r.content_digest === article.content_version,
    ) ||
    row.output?.entries?.some(
      (r) => digest(articleContent(r)) === article.content_version,
    )
  );
}
