import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { exerciseReadingImport } from "../support/reading-import-acceptance.ts";
import { readingImportURL } from "../../src/modules/lighttick/reading/reading-import.types.ts";
import { ReadingService } from "../../src/modules/lighttick/reading/reading.service.ts";
test("reviewed imports retain distinct roots, metadata/private facts, original receipts and tombstones; collection can explicitly reuse exact content", async () => {
  await exerciseReadingImport(new InMemoryLightTickRepository());
});
test("import URL identity preserves protocols and query meaning independently of legacy recommendation identity", () => {
  assert.equal(
    readingImportURL("HTTP://EXAMPLE.COM:80/a?id=3&utm_source=keep#x"),
    "http://example.com/a?id=3&utm_source=keep",
  );
  assert.equal(
    readingImportURL("https://example.com/a?fbclid=business&gclid=business"),
    "https://example.com/a?fbclid=business&gclid=business",
  );
  assert.equal(readingImportURL("https://person:secret@example.com/a"), null);
  assert.equal(readingImportURL("not a URL"), null);
});
test("an oversized duplicate candidate set is rejected wholly without creating an article or receipt", async () => {
  const repo = new InMemoryLightTickRepository(),
    o = { appId: "lighttick", userId: "reading-import-capacity" } as const;
  repo.reading.importCandidates = async () =>
    new Array(101).fill({ id: "article-capacity" });
  await assert.rejects(
    new ReadingService(repo).previewImport(o, {
      content: {
        title: "Synthetic source",
        body: "Capacity original",
        source_url: null,
        language: "en",
        published_at: null,
      },
    }),
    { statusCode: 413 },
  );
  assert.equal(
    (
      await repo.reading.list(o, {
        search: "",
        filter: "all",
        after: "",
        limit: 50,
      })
    ).length,
    0,
  );
});
