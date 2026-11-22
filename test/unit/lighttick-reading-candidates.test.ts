import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { ReadingWorkService } from "../../src/modules/lighttick/independent-reading/reading-work.service.ts";
import { ReadingWorkRunner } from "../../src/modules/lighttick/independent-reading/reading-work.runner.ts";
import { ReadingService } from "../../src/modules/lighttick/independent-reading/reading.service.ts";
import {
  canonicalReadingURL,
  readingCandidateId,
} from "../../src/modules/lighttick/independent-reading/reading-identity.ts";
const owner = {
  appId: "lighttick" as const,
  userId: "reading-candidate-owner",
};
const xml =
  "<rss><channel><language>en</language><title>Raw publisher</title><item><title>Metadata only</title><link>https://example.com/article?utm_source=feed</link><author>Original author</author><pubDate>2016-12-14</pubDate></item><item><title>With excerpt</title><link>https://example.com/excerpt</link><description>Thinking with evidence.</description></item><item><title>Unselected domain</title><link>https://other.example/outside</link><description>Not selected.</description></item></channel></rss>";
async function setup() {
  const repo = new InMemoryLightTickRepository(),
    work = new ReadingWorkService(repo, new InMemoryJobQueue()),
    source = await work.saveSource(
      owner,
      "source-candidate-fixture",
      {
        base_revision: 0,
        title: "Configured source",
        url: "https://example.com/feed",
        format: "rss",
        archived: false,
        language: "zh",
        topics: ["认知"],
        domains: ["example.com"],
      },
      "candidate-source-original",
    );
  const fetches: string[] = [];
  const runner = new ReadingWorkRunner(
    work,
    {
      complete: async () => {
        throw Error("Candidate acquisition cannot call a model");
      },
    } as any,
    async (url) => {
      fetches.push(url);
      return url.includes("/feed")
        ? { body: xml, content_type: "application/rss+xml" }
        : {
            body:
              "<article><p>" +
              "Complete source evidence with a specific argument and its uncertainty. ".repeat(
                4,
              ) +
              "</p></article>",
            content_type: "text/html",
          };
    },
  );
  const created = await work.create(
    owner,
    { kind: "collect_source", source_id: source.id, base_revision: 1 },
    "candidate-collect-original",
  );
  await runner.execute(owner, created.id);
  return {
    repo,
    work,
    runner,
    source,
    fetches,
    done: await work.read(owner, created.id),
  };
}
test("metadata-only feed entries stay reviewable candidates, selected language/topics/domains are frozen and raw source is retained", async () => {
  const f = await setup();
  assert.equal(f.done.status, "succeeded");
  assert.equal(f.done.output!.candidates!.length, 2);
  assert.equal(f.done.output!.entries!.length, 1);
  const candidate = f.done.output!.candidates![0];
  assert.equal(candidate.excerpt, "");
  assert.equal(candidate.content.title, "Metadata only");
  assert.equal(candidate.content.author, "Original author");
  assert.equal(candidate.content.language, "zh");
  assert.equal(candidate.content.publisher, "Configured source");
  assert.deepEqual(candidate.content.topics, ["认知"]);
  assert.equal(candidate.content.published_at, null);
  assert.equal(candidate.content.published_date, "2016-12-14");
  assert.equal(
    candidate.content.source_url,
    "https://example.com/article?utm_source=feed",
  );
  assert.equal("body" in candidate.content, false);
  assert.equal(f.done.output!.document!.body, xml);
  assert.equal(f.fetches.length, 1);
  assert.equal(f.done.output!.warnings!.length, 2);
  const stored = await f.work.store.get(owner, f.done.id);
  assert.deepEqual(stored!.input.source_domains, ["example.com"]);
  assert.equal(stored!.input.source_metadata!.language, "zh");
  const exported = await new ReadingService(f.repo).export(owner);
  assert.equal(exported.work[0].output!.candidates![0].excerpt, "");
});
test("reviewed candidate acquisition binds original output and metadata, retrieves full text separately and cannot transfer another owner or changed source", async () => {
  const f = await setup(),
    candidate = f.done.output!.candidates![0],
    request = {
      kind: "collect_url",
      title: candidate.content.title,
      url: candidate.content.source_url,
      candidate: {
        work_id: f.done.id,
        output_digest: f.done.output_digest,
        candidate_id: candidate.id,
      },
    },
    child = await f.work.create(owner, request, "candidate-fetch-original");
  assert.equal(f.fetches.length, 1);
  assert.equal(child.scope.candidate_id, candidate.id);
  assert.equal(child.scope.candidate_output_digest, f.done.output_digest);
  await f.runner.execute(owner, child.id);
  const completed = await f.work.read(owner, child.id);
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.output!.entries![0].author, "Original author");
  assert.equal(completed.output!.entries![0].published_date, "2016-12-14");
  assert.ok(
    completed.output!.entries![0].body.startsWith("Complete source evidence"),
  );
  const adopted = await f.work.adopt(
      owner,
      child.id,
      {
        base_revision: completed.revision,
        output_digest: completed.output_digest,
        index: 0,
        base_article_revision: null,
      },
      "candidate-adopt-full",
    ),
    article = await new ReadingService(f.repo).read(owner, adopted.article_id);
  assert.equal(article.personal.read, false);
  assert.equal(article.content.author, candidate.content.author);
  assert.deepEqual(
    await f.work.create(owner, request, "candidate-fetch-original"),
    child,
  );
  for (const [id, b, status] of [
    ["candidate-other-owner", request, 409],
    [
      "candidate-wrong-digest",
      {
        ...request,
        candidate: { ...request.candidate, output_digest: "a".repeat(64) },
      },
      409,
    ],
    [
      "candidate-wrong-url",
      { ...request, url: "https://example.com/unselected" },
      409,
    ],
    [
      "candidate-wrong-id",
      {
        ...request,
        candidate: { ...request.candidate, candidate_id: "candidate-missing" },
      },
      404,
    ],
  ] as const)
    await assert.rejects(
      f.work.create(
        id === "candidate-other-owner" ? { ...owner, userId: "other" } : owner,
        b,
        id,
      ),
      { statusCode: status },
    );
  await f.work.saveSource(
    owner,
    f.source.id,
    {
      base_revision: 1,
      title: f.source.title,
      url: f.source.url,
      format: "rss",
      archived: true,
    },
    "candidate-source-withdraw",
  );
  await assert.rejects(
    f.work.create(owner, request, "candidate-withdrawn-fetch"),
    { statusCode: 409 },
  );
  assert.equal(
    (await f.work.read(owner, f.done.id)).output!.candidates![0].excerpt,
    "",
  );
  assert.equal(f.fetches.length, 2);
});
test("legacy recommendation URL identity excludes tracking while keeping the literal source URL separate", () => {
  assert.equal(
    canonicalReadingURL(
      "http://example.com/article?utm_source=old&v=2&fbclid=tracking#p",
    ),
    "https://example.com/article?v=2",
  );
  assert.equal(
    readingCandidateId("https://example.com/article?v=2&gclid=x"),
    readingCandidateId("http://example.com/article?v=2"),
  );
});
