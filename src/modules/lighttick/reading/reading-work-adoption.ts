import type { ReadingWorkService } from "./reading-work.service.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { ReadingService } from "./reading.service.ts";
import {
  digest,
  integer,
  fail,
} from "../learning/native-learning.validation.ts";
export async function adoptReadingWork(
  service: ReadingWorkService,
  o: LightTickOwner,
  id: string,
  b: Record<string, unknown>,
) {
  const row = await service.store.get(o, id);
  if (
    !row ||
    row.status !== "succeeded" ||
    row.revision !== b.base_revision ||
    !row.output ||
    digest(row.output) !== b.output_digest
  )
    fail(409, "请核对已完成任务的精确结果。");
  const reading = new ReadingService(
    service.repo,
    service.authorize,
    service.clock,
  );
  if (row.kind === "fetch_full") {
    const parent = await reading.read(o, row.input.article_id!);
    if (parent.archived || parent.content_version !== row.input.content_version)
      fail(409, "补取来源已变化或已归档，请保留结果核对。");
  }
  let result: { article_id: string; revision: number };
  let target: string;
  if (row.output.entries || row.output.entry_refs) {
    const count = (row.output.entries ?? row.output.entry_refs!).length;
    const index = integer(b.index, 0, count - 1);
    if (b.base_article_revision !== null) fail(422, "原文导入不覆盖已有文章。");
    target = String(index);
    if (row.adopted[target]) fail(409, "此结果已导入，请打开原对象。");
    const reference = row.output.entry_refs?.[index];
    const asset = reference
      ? await service.store.assets.get(o, id, reference.asset_id)
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
        row.output.entries?.[index] ??
        (asset!.value as import("./reading.types.ts").ArticleContent),
      articleId = "article-" + digest(content).slice(0, 40);
    const documentAsset = reference
      ? await service.store.assets.get(o, id, reference.document_id)
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
      (documentAsset?.value as
        | import("./reading-assets.types.ts").ReadingDocumentCapture
        | undefined);
    const old = await service.repo.reading.get(o, articleId);
    const article =
      old ??
      (await reading.write(
        o,
        articleId,
        "import",
        { base_revision: 0, content },
        "reading-import-" + digest([id, index]).slice(0, 40),
        "manual",
        {
          kind:
            row.kind === "fetch_full"
              ? "full_fetch"
              : capture?.capture_kind === "feed_entry"
                ? "feed_entry"
                : capture?.content_type === "application/pdf"
                  ? "pdf_text"
                  : capture
                    ? "web_text"
                    : "legacy_import",
          work_id: row.id,
          source_id: reference?.source_id ?? row.input.source_id ?? null,
          parent_article_id:
            row.kind === "fetch_full" ? row.input.article_id! : null,
          root_article_id: row.input.parent_root_id ?? articleId,
          fetched_at: capture ? row.updated_at : null,
          raw_sha256: capture?.sha256 ?? null,
        },
      ));
    if (old && old.content_version !== digest(content))
      fail(409, "导入对象已变化，不能覆盖。");
    result = { article_id: article.id, revision: article.revision };
  } else {
    if (b.index !== null) fail(422, "AI草稿不使用条目编号。");
    target = "draft";
    if (row.adopted[target]) fail(409, "此任务已保存为草稿，请核对文章历史。");
    const article = await reading.write(
      o,
      row.input.article_id!,
      "draft",
      {
        base_revision: integer(b.base_article_revision, 1, 2147483646),
        content_version: row.input.content_version,
        kind: row.kind,
        paragraph_id: row.input.paragraph_id,
        text: row.output.text,
      },
      "reading-ai-draft-" + digest(id).slice(0, 40),
      "ai",
    );
    result = { article_id: article.id, revision: article.revision };
  }
  const next = {
    ...row,
    revision: row.revision + 1,
    adopted: { ...row.adopted, [target]: result },
    updated_at: service.clock().toISOString(),
  };
  await service.store.save(next, row.revision);
  return {
    work_id: id,
    ...result,
    work:
      b.response_view === "summary"
        ? service.summary(next)
        : service.data(next),
  };
}
