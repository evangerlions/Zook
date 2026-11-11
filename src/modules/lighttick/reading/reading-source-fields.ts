import type { ReadingSource } from "./reading-work.types.ts";
import { READING_DEFAULT_SOURCES, READING_TOPICS } from "./reading-catalog.ts";
import { readingURL } from "./reading-url.ts";
import { text, fail } from "../learning/native-learning.validation.ts";
export function readingSourceFields(
  b: Record<string, unknown>,
  old: ReadingSource | undefined,
  url: string,
) {
  const catalogId = Object.hasOwn(b, "catalog_id")
    ? b.catalog_id
    : old?.url === url
      ? (old.catalog_id ?? null)
      : null;
  const catalog =
    catalogId == null
      ? undefined
      : READING_DEFAULT_SOURCES.find((s) => s.catalog_id === catalogId);
  if (
    catalogId != null &&
    (!catalog || catalog.url !== url || catalog.format !== b.format)
  )
    fail(422, "目录来源身份与链接或格式不符，请明确保存为本人来源。");
  const language =
    b.language ?? old?.language ?? catalog?.language ?? "unknown";
  if (!["zh", "en", "unknown"].includes(String(language)))
    fail(422, "来源语言须为中文、英文或未知。");
  const topics = b.topics ?? old?.topics ?? catalog?.topics ?? [];
  if (
    !Array.isArray(topics) ||
    topics.length > 6 ||
    topics.some(
      (t) => typeof t !== "string" || !Object.hasOwn(READING_TOPICS, t),
    )
  )
    fail(422, "请选择有效的来源主题。");
  const domains = b.domains ??
    (old?.url === url ? old.domains : undefined) ??
    catalog?.domains ?? [new URL(url).hostname];
  if (!Array.isArray(domains) || !domains.length || domains.length > 20)
    fail(422, "请提供1至20个明确允许的原文域名。");
  const validated = domains.map((v) => {
    const raw = text(v, 253, true).trim();
    let u: URL;
    try {
      u = new URL("https://" + raw);
    } catch {
      fail(422, "请核对允许的来源域名。");
    }
    if (
      u.username ||
      u.password ||
      u.port ||
      u.pathname !== "/" ||
      u.search ||
      u.hash ||
      raw.includes("/")
    )
      fail(422, "允许的域名不能包含路径、端口或凭据。");
    readingURL(u.toString());
    return u.hostname.toLowerCase().replace(/\.$/, "");
  });
  return {
    language: language as "zh" | "en" | "unknown",
    topics: [...new Set(topics as string[])],
    domains: [...new Set(validated)],
    catalog_id: catalog?.catalog_id ?? null,
    custom: !catalog,
    deleted_at: null,
  };
}
