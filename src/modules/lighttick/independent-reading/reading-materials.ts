import type { ReadingAIEvidence } from "./reading-ai.types.ts";
import { readingSelectedText, sameReadingRange } from "./reading-scope.ts";
import { readingTextSHA } from "./reading-ai-snapshot.ts";
import {
  fail,
  integer,
  keys,
  object,
  text,
} from "../learning/native-learning.validation.ts";
import type { ReadingArticle, ReadingMaterial } from "./reading.types.ts";

/** Drafts and adopted copies are separate facts; the article journal retains both versions. */
export function writeReadingMaterial(
  article: ReadingArticle,
  raw: unknown,
  adopt: boolean,
  now: string,
  origin: "manual" | "ai" = "manual",
  evidence?: ReadingAIEvidence,
) {
  const b = object(raw);
  keys(b, [
    "base_revision",
    "content_version",
    "kind",
    "paragraph_id",
    "source_range",
    ...(adopt ? ["draft_version"] : ["text"]),
  ]);
  if (article.archived) fail(409, "请先恢复文章，再编辑阅读资料。");
  if (b.content_version !== article.content_version)
    fail(409, "原文已变化，请核对阅读资料来源。");
  if (!["guide", "translation", "summary", "english"].includes(String(b.kind)))
    fail(422, "阅读资料类型无效。");
  const kind = b.kind as ReadingMaterial["kind"];
  const paragraph = b.paragraph_id;
  if (
    kind === "translation" &&
    paragraph === null &&
    b.source_range === undefined
  )
    fail(422, "请选择翻译段落或明确字符范围。");
  if (kind !== "translation" && paragraph !== null)
    fail(422, "此资料请使用明确字符范围，不能混用旧翻译段落编号。");
  const selected = readingSelectedText(
      article.content.body,
      paragraph,
      b.source_range,
    ),
    source_range = b.source_range === undefined ? undefined : selected.range;
  if (
    evidence &&
    (origin !== "ai" ||
      evidence.input_sha256 !== readingTextSHA(selected.text) ||
      evidence.output_sha256 !== readingTextSHA(String(b.text)) ||
      !sameReadingRange(evidence.source_range, selected.range))
  )
    fail(409, "AI资料证据与精确范围不符。");
  const materials = article.materials ?? [];
  const index = materials.findIndex(
    (m) =>
      m.kind === kind &&
      m.paragraph_id === paragraph &&
      sameReadingRange(m.source_range, source_range),
  );
  const previous = materials[index];
  let material: ReadingMaterial;
  if (adopt) {
    const version = integer(b.draft_version, 1, 2147483647);
    if (
      !previous ||
      previous.draft.version !== version ||
      !previous.draft.text.trim() ||
      previous.adopted?.version === version
    )
      fail(409, "请核对尚未采用的非空草稿版本。");
    material = { ...previous, adopted: { ...previous.draft, adopted_at: now } };
  } else {
    const version = (previous?.draft.version ?? 0) + 1;
    integer(version, 1, 2147483647);
    material = {
      kind,
      paragraph_id: paragraph as string | null,
      ...(source_range ? { source_range } : {}),
      draft: {
        text: text(b.text, 100000),
        version,
        origin,
        ...(evidence ? { evidence } : {}),
        ...(origin === "manual" && previous
          ? {
              derived_from: {
                version: previous.draft.version,
                origin: previous.draft.origin,
                work_id:
                  previous.draft.evidence?.work_id ??
                  previous.draft.derived_from?.work_id ??
                  null,
              },
            }
          : {}),
        created_at: now,
      },
      adopted: previous?.adopted ?? null,
    };
  }
  article.materials =
    index < 0
      ? [...materials, material]
      : materials.map((m, i) => (i === index ? material : m));
  if (Buffer.byteLength(JSON.stringify(article)) > 2 * 1024 * 1024)
    fail(413, "文章与阅读资料超过2MiB，请分篇整理；本次输入未写入。");
}
