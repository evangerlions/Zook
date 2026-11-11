import { createHash } from "node:crypto";
import type { ReadingWork } from "./reading-work.types.ts";
import { articleContent } from "./reading.validation.ts";
import { readingFeedCandidates } from "./reading-feed.ts";
import { visibleHtmlText } from "../../../shared/visible-html-text.ts";
import { fail } from "../learning/native-learning.validation.ts";
export interface ReadingDocument {
  body: string;
  content_type: string;
  encoding?: "base64";
  resolved_url?: string;
}
export const readingVisibleText = (raw: string) => visibleHtmlText(raw);
export function collectReadingDocument(
  work: Pick<ReadingWork, "kind" | "input">,
  document: ReadingDocument,
) {
  const { body, content_type } = document;
  if (Buffer.byteLength(body) > 2_000_000)
    fail(413, "采集文本超过2000000字节，未截断导入。");
  const format = work.input.format;
  const feed = format === "article" ? null : readingFeedCandidates(work, body);
  const entries = feed
    ? feed.candidates
        .filter((c) => !!c.excerpt.trim())
        .map((c) => articleContent({ ...c.content, body: c.excerpt }))
    : [
        articleContent({
          ...work.input.source_metadata,
          title: work.input.title,
          body: content_type.startsWith("text/html")
            ? readingVisibleText(body)
            : body,
          source_url: work.input.url,
          language: work.input.source_metadata?.language ?? "unknown",
          published_at: work.input.source_metadata?.published_at ?? null,
          author: work.input.source_metadata?.author ?? null,
          tags: work.input.source_metadata?.tags ?? [],
        }),
      ];
  if (
    format === "article" &&
    !/^text\/(plain|markdown|html)(?:;|$)/.test(content_type)
  )
    fail(422, "此来源不是文本文章，请核对格式。");
  return {
    entries,
    ...(feed ? feed : {}),
    document: {
      ...document,
      url: work.input.url!,
      sha256: createHash("sha256").update(body, "utf8").digest("hex"),
      capture_kind:
        work.kind === "fetch_full"
          ? "full_fetch"
          : format === "article"
            ? "web_text"
            : "feed_entry",
    },
  };
}
