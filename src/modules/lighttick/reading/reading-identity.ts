import { createHash } from "node:crypto";
import { readingURL } from "./reading-url.ts";
/** Legacy recommendation identity; the literal selected URL remains in source metadata. */
export function canonicalReadingURL(raw: string): string {
  const url = new URL(readingURL(raw));
  url.protocol = "https:";
  url.port = "";
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (
      ["utm_", "fbclid", "gclid"].some((prefix) =>
        key.toLowerCase().startsWith(prefix),
      )
    )
      url.searchParams.delete(key);
  return url.toString();
}
export const readingCandidateId = (url: string) =>
  "candidate-" +
  createHash("sha256")
    .update(canonicalReadingURL(url))
    .digest("hex")
    .slice(0, 40);
