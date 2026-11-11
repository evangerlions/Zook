import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { ArticleContent, ReadingProvenance } from "./reading.types.ts";
import {
  readingImportURL,
  type ReadingImportScope,
  type ReadingImportDecision,
} from "./reading-import.types.ts";
import {
  digest,
  fail,
  keys,
  object,
} from "../learning/native-learning.validation.ts";
import { articleId } from "./reading.validation.ts";
export async function readingImportScope(
  repo: LightTickRepository,
  o: LightTickOwner,
  content: ArticleContent,
  parentId?: string,
): Promise<ReadingImportScope> {
  const content_version = digest(content),
    url_key = readingImportURL(content.source_url),
    candidates = await repo.reading.importCandidates(
      o,
      url_key,
      content_version,
      101,
      parentId,
    );
  if (candidates.length > 100)
    fail(413, "相关重复文章超过100篇，未返回不完整导入范围。");
  const tombstone = await repo.readingErasure.contentTombstone(
    o,
    content_version,
  );
  const value = {
    identity_version: "whatwg-fragment-v1" as const,
    content_version,
    url_key,
    candidates,
    deleted: tombstone
      ? { id: tombstone.id, deleted_at: tombstone.deleted_at }
      : null,
  };
  return { ...value, digest: digest(value) };
}
export function readingImportDecision(raw: unknown): ReadingImportDecision {
  const b = object(raw);
  keys(b, ["scope_digest", "mode", "article_id"]);
  if (
    typeof b.scope_digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(b.scope_digest) ||
    !["independent", "edition", "existing"].includes(String(b.mode))
  )
    fail(422, "请核对导入决定与范围摘要。");
  if (b.mode === "independent" ? b.article_id !== null : !b.article_id)
    fail(422, "请明确选定已有对象或独立新身份。");
  if (b.article_id !== null) articleId(b.article_id);
  return {
    scope_digest: b.scope_digest as string,
    mode: b.mode as ReadingImportDecision["mode"],
    article_id: b.article_id as string | null,
  };
}
export async function resolveReadingImport(
  repo: LightTickRepository,
  o: LightTickOwner,
  content: ArticleContent,
  raw: unknown,
  newId: string,
  provenance?: ReadingProvenance,
) {
  const scope = await readingImportScope(
    repo,
    o,
    content,
    provenance?.kind === "full_fetch"
      ? (provenance.parent_article_id ?? undefined)
      : undefined,
  );
  if (raw === undefined) {
    // An explicitly requested full-fetch already names its parent and preserves that frozen relationship.
    if (
      provenance?.kind === "full_fetch" &&
      !scope.deleted &&
      !scope.candidates.some((r) => r.content_version === scope.content_version)
    )
      return { provenance };
    if (scope.candidates.length || scope.deleted)
      fail(
        409,
        "已有相同内容、同来源版本或删除记录，请先核对导入范围并明确选择。",
      );
    return { provenance };
  }
  const decision = readingImportDecision(raw);
  if (decision.scope_digest !== scope.digest)
    fail(409, "导入范围已变化，请保留原输入并重新核对重复项。");
  const selected = scope.candidates.find((r) => r.id === decision.article_id);
  if (decision.mode === "existing") {
    if (!selected || selected.content_version !== scope.content_version)
      fail(409, "只能关联完整内容完全相同的已有文章。");
    return { existing_id: selected.id };
  }
  if (
    decision.mode === "edition" &&
    (!selected || selected.content_version === scope.content_version)
  )
    fail(
      409,
      "关联新版本需要选定已有来源对象与不同的完整内容；相同内容请打开或另存副本。",
    );
  const base: ReadingProvenance = provenance ?? {
    kind: "manual_import",
    work_id: null,
    source_id: null,
    parent_article_id: null,
    root_article_id: newId,
    fetched_at: null,
    raw_sha256: null,
  };
  return {
    provenance: {
      ...base,
      parent_article_id: decision.mode === "edition" ? selected!.id : null,
      root_article_id:
        decision.mode === "edition" ? selected!.root_article_id : newId,
    },
  };
}
