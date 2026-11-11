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
) {
  const b = object(raw);
  keys(b, [
    "base_revision",
    "content_version",
    "kind",
    "paragraph_id",
    ...(adopt ? ["draft_version"] : ["text"]),
  ]);
  if (article.archived) fail(409, "请先恢复文章，再编辑阅读资料。");
  if (b.content_version !== article.content_version)
    fail(409, "原文已变化，请核对阅读资料来源。");
  if (!["guide", "translation", "summary", "english"].includes(String(b.kind)))
    fail(422, "阅读资料类型无效。");
  const kind = b.kind as ReadingMaterial["kind"];
  const paragraph = b.paragraph_id;
  if (kind === "translation") {
    if (
      typeof paragraph !== "string" ||
      !/^p-[1-9][0-9]{0,5}$/.test(paragraph) ||
      Number(paragraph.slice(2)) > article.content.body.split(/\n\s*\n/).length
    )
      fail(422, "请选择此原文中的段落。");
  } else if (paragraph !== null) fail(422, "此资料不使用段落编号。");
  const materials = article.materials ?? [];
  const index = materials.findIndex(
    (m) => m.kind === kind && m.paragraph_id === paragraph,
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
      draft: {
        text: text(b.text, 100000),
        version,
        origin,
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
