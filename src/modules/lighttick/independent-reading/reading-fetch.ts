import { fetchPublicSourceBytes } from "../learning/learning-sources.ts";
import { readingURL } from "./reading-url.ts";
import type { ReadingDocument } from "./reading-collection.ts";
/** Each redirect is a fresh validated, pinned public connection; no cookies or credentials cross hops. */
export async function fetchReadingSource(
  raw: string,
  signal: AbortSignal,
  fetchBytes = fetchPublicSourceBytes,
): Promise<ReadingDocument> {
  let current = readingURL(raw);
  const visited = new Set<string>();
  for (let hop = 0; hop < 5; hop++) {
    if (visited.has(current)) throw Error("SOURCE_REDIRECT_LOOP");
    visited.add(current);
    const result = await fetchBytes(
      current,
      signal,
      undefined,
      8_000_000,
      true,
    );
    signal.throwIfAborted();
    if (result.redirect) {
      current = readingURL(new URL(result.redirect, current).toString());
      continue;
    }
    const pdf =
      /^application\/pdf(?:;|$)/.test(result.content_type) ||
      result.bytes.subarray(0, 5).equals(Buffer.from("%PDF-"));
    return {
      body: pdf
        ? result.bytes.toString("base64")
        : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
            result.bytes,
          ),
      content_type: pdf
        ? "application/pdf"
        : result.content_type || "text/html",
      ...(pdf ? { encoding: "base64" as const } : {}),
      resolved_url: current,
    };
  }
  throw Error("SOURCE_TOO_MANY_REDIRECTS");
}
