import {
  identity,
  text,
  integer,
  object,
  keys,
  fail,
} from "../learning/native-learning.validation.ts";
import type {
  ArticleContent,
  ArticleQuery,
  ArticlePrivate,
} from "./reading.types.ts";
export const articleId = (v: unknown) => identity(v, "article-");
export function articleContent(raw: unknown): ArticleContent {
  const b = object(raw);
  keys(b, [
    "title",
    "body",
    "source_url",
    "language",
    "published_at",
    "author",
    "tags",
  ]);
  const url = b.source_url == null ? null : text(b.source_url, 2048, true);
  if (url) {
    try {
      const u = new URL(url);
      if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
        fail(422, "来源地址须为无凭据的HTTP或HTTPS地址。");
    } catch {
      fail(422, "请核对来源地址。");
    }
  }
  const published =
    b.published_at == null ? null : text(b.published_at, 30, true);
  if (
    published &&
    (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(published) ||
      !Number.isFinite(Date.parse(published)) ||
      new Date(published).toISOString().slice(0, 19) !== published.slice(0, 19))
  )
    fail(422, "发布日期须为有效UTC时间；未知请保留为空。");
  const language = text(b.language ?? "unknown", 35, true);
  if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(language)) fail(422, "语言标识无效。");
  const author = b.author == null ? null : text(b.author, 500);
  const tags = b.tags ?? [];
  if (!Array.isArray(tags) || tags.length > 100)
    fail(422, "文章标签最多100项。");
  const validatedTags = tags.map((value) => text(value, 200, true));
  return {
    title: text(b.title, 200, true),
    body: text(b.body, 100000, true),
    source_url: url,
    language,
    published_at: published,
    author,
    tags: validatedTags,
  };
}
export function articleQuery(
  raw: Record<string, string | undefined> = {},
): ArticleQuery {
  const filter = raw.filter ?? "all";
  if (
    !["all", "bookmark", "later", "read", "feedback", "archived"].includes(
      filter,
    )
  )
    fail(422, "阅读筛选无效。");
  const limit = raw.limit === undefined ? 20 : Number(raw.limit);
  integer(limit, 1, 50);
  return {
    filter: filter as ArticleQuery["filter"],
    search: text(raw.search ?? "", 300),
    after: raw.cursor ? articleId(raw.cursor) : "",
    limit,
  };
}
export function personalFields(
  raw: unknown,
  old: ArticlePrivate,
  now: string,
): ArticlePrivate {
  const b = object(raw);
  keys(b, ["notes", "bookmark", "later", "read", "feedback"]);
  for (const k of ["bookmark", "later", "read"])
    if (typeof b[k] !== "boolean") fail(422, "请明确阅读、收藏和稍后读状态。");
  return {
    ...old,
    notes: text(b.notes, 60000),
    feedback: text(b.feedback, 10000),
    bookmark: b.bookmark,
    later: b.later,
    read: b.read,
    read_at: b.read ? (old.read_at ?? now) : null,
  };
}
