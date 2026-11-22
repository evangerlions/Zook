import type { LightTickOwner } from "../lighttick.types.ts";
import type { ArticleContent } from "./reading.types.ts";
import type { ReadingWork } from "./reading-work.types.ts";
export type ReadingDocumentCapture = NonNullable<
  NonNullable<ReadingWork["output"]>["document"]
>;
export interface ReadingAsset {
  id: string;
  work_id: string;
  sha256: string;
  kind: "entry" | "document";
  value: ArticleContent | ReadingDocumentCapture;
}
export interface ReadingEntryReference {
  asset_id: string;
  content: Omit<ArticleContent, "body">;
  content_digest: string;
  document_id: string;
  extraction_version: string;
  source_id: string | null;
}
export interface ReadingAssetsRepository {
  get(
    o: LightTickOwner,
    workId: string,
    id: string,
  ): Promise<ReadingAsset | undefined>;
  list(
    o: LightTickOwner,
    workId: string,
  ): Promise<Omit<ReadingAsset, "value">[]>;
  save(o: LightTickOwner, row: ReadingAsset): Promise<void>;
}
