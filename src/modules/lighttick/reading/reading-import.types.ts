export interface ReadingImportCandidate {
  id: string;
  revision: number;
  content_version: string;
  title: string;
  source_url: string | null;
  archived: boolean;
  root_article_id: string;
  parent_article_id: string | null;
}
export interface ReadingImportScope {
  identity_version: "whatwg-fragment-v1";
  content_version: string;
  url_key: string | null;
  candidates: ReadingImportCandidate[];
  deleted: { id: string; deleted_at: string } | null;
  digest: string;
}
export interface ReadingImportDecision {
  scope_digest: string;
  mode: "independent" | "edition" | "existing";
  article_id: string | null;
}
/** Conservative import identity; never reuse or mutate legacy recommendation normalization. */
export function readingImportURL(raw: string | null): string | null {
  if (raw === null) return null;
  try {
    const url = new URL(raw);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
