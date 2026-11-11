import { createHash } from "node:crypto";
import type { ReadingWorkRunner } from "./reading-work.runner.ts";
import type { ReadingWork } from "./reading-work.types.ts";
import type {
  ReadingAsset,
  ReadingDocumentCapture,
  ReadingEntryReference,
} from "./reading-assets.types.ts";
import type { ReadingCandidate } from "./reading-candidate.types.ts";
import type { ReadingDocument } from "./reading-collection.ts";
import {
  readingDocumentBytes,
  READING_SOURCE_BYTES,
} from "./reading-fulltext.ts";
import { parseReadingDocument } from "./reading-parser.ts";
import {
  chooseReadingCandidates,
  READING_RANKING_VERSION,
} from "./reading-recommendation.ts";
import { READING_CLASSICS } from "./reading-catalog.ts";
import { readingCandidateId } from "./reading-identity.ts";
import { readingFailureCode } from "./reading-failure.ts";
import { digest, fail } from "../learning/native-learning.validation.ts";
export async function performReadingRecommendation(
  runner: ReadingWorkRunner,
  row: ReadingWork,
  signal: AbortSignal,
): Promise<NonNullable<ReadingWork["output"]>> {
  const frozen = row.input.recommendation;
  if (!frozen || frozen.scope.ranking_version !== READING_RANKING_VERSION)
    throw Error("READING_CONTEXT_STALE");
  const { scope, feedback, seen } = frozen,
    warnings: string[] = [],
    documents: { asset_id: string; url: string; sha256: string }[] = [],
    candidates: ReadingCandidate[] = [],
    entry_refs: ReadingEntryReference[] = [],
    selected: ReadingCandidate[] = [];
  let rawBytes = 0;
  async function save(
    kind: ReadingAsset["kind"],
    value: ReadingAsset["value"],
  ) {
    const sha256 = digest(value),
      asset: ReadingAsset = {
        id: "readasset-" + digest([kind, sha256]).slice(0, 40),
        work_id: row.id,
        sha256,
        kind,
        value,
      };
    signal.throwIfAborted();
    await runner.repo.transaction(row, async () => {
      await runner.valid(row);
      signal.throwIfAborted();
      await runner.store.assets.save(row, asset);
    });
    return asset.id;
  }
  async function archive(
    url: string,
    document: ReadingDocument,
    capture_kind: ReadingDocumentCapture["capture_kind"],
  ) {
    const raw = readingDocumentBytes(document);
    if (raw.length > READING_SOURCE_BYTES)
      fail(413, "Reading source exceeds8MB");
    rawBytes += raw.length;
    if (rawBytes > 384000000)
      fail(413, "Reading collection exceeds bounded archive capacity");
    const value: ReadingDocumentCapture = {
      ...document,
      url,
      sha256: createHash("sha256").update(raw).digest("hex"),
      capture_kind,
      ...(document.body.includes("\0")
        ? { body: raw.toString("base64"), encoding: "base64" as const }
        : {}),
    };
    const asset_id = await save("document", value);
    documents.push({ asset_id, url, sha256: value.sha256 });
    return asset_id;
  }
  async function pool<T>(
    items: T[],
    fn: (item: T) => Promise<void>,
    stage: AbortSignal,
  ) {
    let index = 0;
    const settled = await Promise.allSettled(
      Array.from({ length: Math.min(3, items.length) }, async () => {
        while (index < items.length && !stage.aborted) {
          const item = items[index++];
          await fn(item);
        }
      }),
    );
    const rejected = settled.find(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    if (rejected) throw rejected.reason;
  }
  if (scope.preferences.value.mode !== "classic") {
    const stage = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
    await pool(
      scope.sources,
      async (source) => {
        let doc: ReadingDocument;
        try {
          doc = await runner.fetchDocument(source.url, stage);
        } catch (error) {
          if (signal.aborted) signal.throwIfAborted();
          warnings.push(
            source.title + " (" + source.url + ")" +
              ": source acquisition failed; no replacement provider selected.",
          );
          return;
        }
        if (stage.aborted) {
          warnings.push(source.title + " (" + source.url + ")" + ": source discovery timed out.");
          return;
        }
        await archive(
          source.url,
          doc,
          source.format === "article" ? "web_text" : "feed_entry",
        );
        if (source.format === "article") {
          warnings.push(
            source.title + " (" + source.url + ")" +
              ": direct article source has no dated recommendation feed; collect its URL explicitly.",
          );
          return;
        }
        try {
          const result = await parseReadingDocument(
            {
              kind: "collect_source",
              input: {
                url: source.url,
                format: source.format,
                source_domains: source.domains,
                source_id: source.id,
                source_revision: source.revision,
                source_metadata: {
                  title: source.title,
                  source_url: source.url,
                  language: source.language ?? "unknown",
                  topics: source.topics ?? [],
                  publisher: source.title,
                  published_at: null,
                },
              },
            },
            doc,
            stage,
          );
          candidates.push(...(result.candidates ?? []));
          if (result.warnings?.length)
            warnings.push(source.title + " (" + source.url + ")" + ": " + result.warnings.join(" "));
        } catch (error) {
          if (signal.aborted) signal.throwIfAborted();
          warnings.push(
            source.title + " (" + source.url + ")" +
              ": " +
              (readingFailureCode(error) ?? "feed parsing unavailable"),
          );
        }
      },
      stage,
    );
    signal.throwIfAborted();
    if (stage.aborted)
      warnings.push(
        "Source discovery reached30s; unfinished sources were not replaced.",
      );
  }
  candidates.push(
    ...READING_CLASSICS.map((c) => ({
      id: readingCandidateId(c.source_url),
      content: { ...c, topics: [...c.topics] },
      excerpt: c.description,
      source_id: null,
      source_revision: null,
    })),
  );
  const attempted = new Set(seen),
    stage = AbortSignal.any([signal, AbortSignal.timeout(120000)]);
  let attempts = 0;
  while (
    selected.length < scope.preferences.value.count &&
    attempts < 24 &&
    !stage.aborted
  ) {
    const next = chooseReadingCandidates(
      candidates,
      scope.preferences.value,
      attempted,
      scope.date,
      row.id,
      feedback,
      selected,
    ).slice(selected.length, selected.length + Math.min(3, 24 - attempts));
    if (!next.length) break;
    const outcomes = await Promise.all(
      next.map(async (candidate) => {
        attempted.add(candidate.id);
        attempts++;
        const url = candidate.content.source_url!;
        let doc: ReadingDocument;
        const one = AbortSignal.any([stage, AbortSignal.timeout(20000)]);
        try {
          doc = await runner.fetchDocument(url, one);
        } catch (error) {
          if (signal.aborted) throw signal.reason;
          warnings.push(
            candidate.content.title + " (" + candidate.content.source_url + ")" +
              ": full-text acquisition failed; no replacement provider selected.",
          );
          return;
        }
        if (one.aborted) {
          if (signal.aborted) throw signal.reason;
          warnings.push(candidate.content.title + " (" + candidate.content.source_url + ")" + ": full-text acquisition timed out.");
          return;
        }
        const document_id = await archive(url, doc, "full_fetch");
        let result: NonNullable<ReadingWork["output"]>;
        try {
          result = await parseReadingDocument(
            {
              kind: "fetch_full",
              input: {
                url,
                title: candidate.content.title,
                format: "article",
                source_metadata: structuredClone(candidate.content),
              },
            },
            doc,
            one,
          );
        } catch (error) {
          if (signal.aborted) throw signal.reason;
          warnings.push(
            candidate.content.title + " (" + candidate.content.source_url + ")" +
              ": " +
              (readingFailureCode(error) ?? "full text unreadable"),
          );
          return;
        }
        const content = result.entries?.[0];
        if (!content) {
          warnings.push(
            candidate.content.title + " (" + candidate.content.source_url + ")" +
              ": no readable full text; metadata was not saved as an article.",
          );
          return;
        }
        const asset_id = await save("entry", content);
        const { body, ...metadata } = content;
        return {
          candidate,
          reference: {
            asset_id,
            document_id,
            extraction_version:
              result.document?.extraction_version ?? "unknown",
            source_id: candidate.source_id,
            content: metadata,
            content_digest: digest(content),
          },
        };
      }),
    );
    for (const outcome of outcomes)
      if (outcome) {
        selected.push(outcome.candidate);
        entry_refs.push(outcome.reference);
      }
  }
  signal.throwIfAborted();
  if (stage.aborted)
    warnings.push(
      "Full-text checks reached120s; refresh does not repeat them.",
    );
  if (selected.length < scope.preferences.value.count)
    warnings.push(
      "Insufficient independently readable full text: " +
        selected.length +
        "/" +
        scope.preferences.value.count +
        ". No excerpt was counted as full text.",
    );
  return {
    entry_refs,
    documents,
    warnings,
    recommendation: {
      date: scope.date,
      requested: scope.preferences.value.count,
      selected: selected.length,
      attempted: attempts,
      ranking_version: scope.ranking_version,
      scope_digest: scope.digest,
    },
  };
}
