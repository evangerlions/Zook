import { createHash } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { ArticleContent } from "./reading.types.ts";
import type { ReadingWork } from "./reading-work.types.ts";
import { articleContent } from "./reading.validation.ts";
import { readingURL } from "./reading-work.service.ts";
import { fail } from "../learning/native-learning.validation.ts";
export interface ReadingDocument {
  body: string;
  content_type: string;
}
const scalar = (v: any): string =>
  typeof v === "string"
    ? v
    : typeof v === "number"
      ? String(v)
      : v && typeof v === "object"
        ? scalar(v["#text"])
        : "";
const array = (v: any): any[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];
function entities(v: string) {
  return v.replace(
    /&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);/gi,
    (all, key: string) => {
      if (key.startsWith("#")) {
        const n =
          key[1].toLowerCase() === "x"
            ? parseInt(key.slice(2), 16)
            : Number(key.slice(1));
        return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
          ? String.fromCodePoint(n)
          : all;
      }
      return (
        (
          {
            amp: "&",
            lt: "<",
            gt: ">",
            quot: '"',
            apos: "'",
            nbsp: " ",
          } as Record<string, string>
        )[key.toLowerCase()] ?? all
      );
    },
  );
}
/** Visible text is a preview; exact downloaded bytes remain in the work document. No HTML is rendered. */
export function readingVisibleText(raw: string) {
  return entities(
    raw
      .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<!--[^]*?-->/g, "")
      .replace(
        /<(?:\/p|\/div|\/section|\/article|\/h[1-6]|br|\/li)\b[^>]*>/gi,
        "\n\n",
      )
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function published(v: any) {
  const raw = scalar(v);
  if (!raw || !/(?:Z|[+-]\d\d:?\d\d|GMT|UTC)$/i.test(raw.trim())) return null;
  const stamp = Date.parse(raw);
  return Number.isFinite(stamp) ? new Date(stamp).toISOString() : null;
}
function link(raw: any, base: string) {
  const value = scalar(raw);
  if (!value) fail(422, "订阅条目缺少可核对的原文链接。");
  try {
    return readingURL(new URL(value, base).toString());
  } catch {
    fail(422, "订阅条目链接不可采集。");
  }
}
export function collectReadingDocument(
  work: ReadingWork,
  document: ReadingDocument,
) {
  const { body, content_type } = document;
  if (Buffer.byteLength(body) > 2_000_000)
    fail(413, "采集原文超过2000000字节，未截断导入。");
  const format = work.input.format;
  let entries: ArticleContent[];
  if (format === "article") {
    if (!/^text\/(plain|markdown|html)(?:;|$)/.test(content_type))
      fail(422, "此来源不是文本文章，请选择订阅格式。");
    entries = [
      articleContent({
        title: work.input.title,
        body: content_type.startsWith("text/html")
          ? readingVisibleText(body)
          : body,
        source_url: work.input.url,
        language: "unknown",
        published_at: null,
        author: null,
        tags: [],
      }),
    ];
  } else {
    if (/<!DOCTYPE|<!ENTITY/i.test(body))
      fail(422, "不接受含DTD或外部实体的订阅内容。");
    if (XMLValidator.validate(body) !== true)
      fail(422, "订阅XML无法解析，未导入部分结果。");
    const parsed = new XMLParser({
      maxNestedTags: 40,
      removeNSPrefix: true,
      ignoreAttributes: false,
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: false,
      processEntities: false,
    }).parse(body);
    const feed = format === "rss" ? parsed.rss?.channel : parsed.feed;
    if (!feed) fail(422, "来源与选定的RSS/Atom格式不符。");
    const items = array(format === "rss" ? feed.item : feed.entry);
    if (items.length > 80)
      fail(413, "本次订阅超过80条，请使用来源分页；未截断导入。");
    entries = items.map((item) => {
      const atomLink = array(item.link).find(
        (l) =>
          typeof l === "object" && (!l["@_rel"] || l["@_rel"] === "alternate"),
      );
      const rawText =
        format === "rss"
          ? (item.encoded ?? item["content:encoded"] ?? item.description)
          : (item.content ?? item.summary);
      const tags = array(format === "rss" ? item.category : item.category)
        .map((c) =>
          entities(format === "rss" ? scalar(c) : scalar(c?.["@_term"])),
        )
        .filter(Boolean);
      return articleContent({
        title: entities(scalar(item.title)).trim(),
        body: readingVisibleText(scalar(rawText)),
        source_url: link(
          format === "rss" ? item.link : atomLink?.["@_href"],
          work.input.url!,
        ),
        language: /^[a-zA-Z][a-zA-Z0-9-]{0,34}$/.test(
          scalar(feed.language ?? feed["@_lang"] ?? feed["@_xml:lang"]),
        )
          ? scalar(feed.language ?? feed["@_lang"] ?? feed["@_xml:lang"])
          : "unknown",
        published_at: published(item.pubDate ?? item.published ?? item.updated),
        author:
          entities(
            scalar(
              item.author?.name ??
                item.author ??
                item.creator ??
                item["dc:creator"],
            ),
          ) || null,
        tags,
      });
    });
  }
  return {
    entries,
    document: {
      ...document,
      url: work.input.url!,
      sha256: createHash("sha256").update(body, "utf8").digest("hex"),
      capture_kind: format === "article" ? "web_text" : "feed_entry",
    },
  };
}
