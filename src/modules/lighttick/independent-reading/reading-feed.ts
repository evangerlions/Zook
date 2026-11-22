import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { ReadingWork } from "./reading-work.types.ts";
import type { ReadingCandidate } from "./reading-candidate.types.ts";
import { readingCandidateId } from "./reading-identity.ts";
import { readingURL } from "./reading-url.ts";
import { visibleHtmlText } from "../../../shared/visible-html-text.ts";
import { articleContent } from "./reading.validation.ts";
import { fail } from "../learning/native-learning.validation.ts";
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
  return visibleHtmlText(v);
}
function dates(value: any) {
  const raw = scalar(value).trim();
  if (/^\d{4}-\d\d-\d\d$/.test(raw)) {
    const stamp = Date.parse(raw + "T00:00:00Z");
    return {
      published_at: null,
      published_date:
        Number.isFinite(stamp) &&
        new Date(stamp).toISOString().slice(0, 10) === raw
          ? raw
          : null,
    };
  }
  const stamp = /(?:Z|[+-]\d\d:?\d\d|GMT|UTC)$/i.test(raw)
    ? Date.parse(raw)
    : NaN;
  return {
    published_at: Number.isFinite(stamp) ? new Date(stamp).toISOString() : null,
    published_date: null,
  };
}
export function readingFeedCandidates(
  work: Pick<ReadingWork, "input">,
  body: string,
) {
  if (Buffer.byteLength(body) > 2_000_000)
    fail(413, "订阅超过2000000字节，未截断导入。");
  if (/<!DOCTYPE|<!ENTITY/i.test(body))
    fail(422, "不接受含DTD或外部实体的订阅内容。");
  if ((body.match(/</g)?.length ?? 0) > 40000) fail(413, "订阅标记超过容量。");
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
    }).parse(body),
    format = work.input.format,
    feed = format === "rss" ? parsed.rss?.channel : parsed.feed;
  if (!feed) fail(422, "来源与选定的RSS/Atom格式不符。");
  const items = array(format === "rss" ? feed.item : feed.entry);
  if (items.length > 80) fail(413, "订阅超过80条，未截断导入。");
  const candidates: ReadingCandidate[] = [],
    seen = new Set<string>();
  let outside = 0,
    invalid = 0,
    empty = 0,
    duplicate = 0;
  for (const item of items) {
    const atom = array(item.link).find(
        (l) =>
          typeof l === "object" && (!l["@_rel"] || l["@_rel"] === "alternate"),
      ),
      rawLink = scalar(format === "rss" ? item.link : atom?.["@_href"]);
    let url: string;
    try {
      if (!rawLink) throw Error("no link");
      url = readingURL(new URL(rawLink, work.input.url).toString());
    } catch {
      invalid++;
      continue;
    }
    if (
      work.input.source_domains &&
      !work.input.source_domains.includes(
        new URL(url).hostname.toLowerCase().replace(/\.$/, ""),
      )
    ) {
      outside++;
      continue;
    }
    const title = entities(scalar(item.title)).trim();
    if (!title) {
      invalid++;
      continue;
    }
    const rawText = scalar(
        format === "rss"
          ? (item.encoded ?? item["content:encoded"] ?? item.description)
          : (item.content ?? item.summary),
      ),
      excerpt = visibleHtmlText(rawText);
    if (!excerpt) empty++;
    const metadata = work.input.source_metadata,
      language =
        metadata?.language && metadata.language !== "unknown"
          ? metadata.language
          : scalar(feed.language ?? feed["@_lang"] ?? feed["@_xml:lang"]),
      tags = array(item.category)
        .map((c) =>
          entities(format === "rss" ? scalar(c) : scalar(c?.["@_term"])),
        )
        .filter(Boolean);
    // Validate metadata without inventing a source body; an empty excerpt remains a candidate only.
    const validated = articleContent({
      title,
      body: "validation-only",
      source_url: url,
      language: /^[a-zA-Z][a-zA-Z0-9-]{0,34}$/.test(language)
        ? language
        : "unknown",
      ...dates(item.pubDate ?? item.published ?? item.updated),
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
      publisher: metadata?.publisher ?? (entities(scalar(feed.title)) || null),
      ...(metadata?.topics ? { topics: metadata.topics } : {}),
      category: "recent",
      description: excerpt.length <= 10000 ? excerpt : null,
      access: "订阅条目可能只有摘要，未核验原文全文。",
    });
    const { body: _, ...content } = validated;
    const id = readingCandidateId(url);
    if (seen.has(id)) {
      duplicate++;
      continue;
    }
    seen.add(id);
    candidates.push({
      id,
      content,
      excerpt,
      source_id: work.input.source_id ?? null,
      source_revision: work.input.source_revision ?? null,
    });
  }
  const warnings: string[] = [];
  if (outside)
    warnings.push(`${outside}条链接不属于本次选定的原文域名，未纳入候选。`);
  if (invalid)
    warnings.push(
      `${invalid}条订阅缺少可核对的标题或链接，原始下载保留供核对。`,
    );
  if (duplicate)
    warnings.push(
      `${duplicate}条重复链接已合并为同一候选；原始订阅记录完整保留。`,
    );
  if (empty)
    warnings.push(
      `${empty}条订阅未提供摘要，已保留候选元数据；需补取可读正文后保存文章。`,
    );
  return { candidates, warnings };
}
