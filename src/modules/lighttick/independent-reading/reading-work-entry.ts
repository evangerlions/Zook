import type { ReadingWorkService } from "./reading-work.service.ts";
import type { ReadingWork } from "./reading-work.types.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { ArticleContent } from "./reading.types.ts";
import type { ReadingDocumentCapture } from "./reading-assets.types.ts";
import {
  digest,
  fail,
  integer,
} from "../learning/native-learning.validation.ts";
/** Reuse the exact immutable selected result for preview and adoption; never fetch a supplier again. */
export async function readingWorkEntry(
  service: ReadingWorkService,
  o: LightTickOwner,
  row: ReadingWork,
  value: unknown,
) {
  const count = (row.output?.entries ?? row.output?.entry_refs)?.length;
  if (row.status !== "succeeded" || !row.output || !count)
    fail(409, "请核对含原文结果的已完成任务。");
  const index = integer(value, 0, count - 1),
    reference = row.output.entry_refs?.[index],
    asset = reference
      ? await service.store.assets.get(o, row.id, reference.asset_id)
      : undefined;
  if (
    reference &&
    (!asset ||
      asset.kind !== "entry" ||
      asset.sha256 !== reference.content_digest ||
      digest(asset.value) !== reference.content_digest)
  )
    fail(409, "Reading result asset unavailable");
  const content =
    row.output.entries?.[index] ?? (asset!.value as ArticleContent);
  const documentAsset = reference
    ? await service.store.assets.get(o, row.id, reference.document_id)
    : undefined;
  if (
    reference &&
    (!documentAsset ||
      documentAsset.kind !== "document" ||
      digest(documentAsset.value) !== documentAsset.sha256)
  )
    fail(409, "Reading original document unavailable");
  const capture =
    row.output.document ??
    (documentAsset?.value as ReadingDocumentCapture | undefined);
  return { index, content, reference, capture };
}
