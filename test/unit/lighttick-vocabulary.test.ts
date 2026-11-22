import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { ReadingService } from "../../src/modules/lighttick/independent-reading/reading.service.ts";
import { VocabularyService } from "../../src/modules/lighttick/independent-reading/vocabulary.service.ts";
const owner = { appId: "lighttick", userId: "vocabulary-synthetic" } as const;
const other = { ...owner, userId: "vocabulary-other" };
async function setup() {
  const repo = new InMemoryLightTickRepository();
  let now = new Date("2026-11-11T15:59:00Z");
  const s = new VocabularyService(
    repo,
    async () => {},
    () => now,
  );
  const article = await new ReadingService(repo).write(
    owner,
    "article-vocabulary",
    "import",
    {
      base_revision: 0,
      content: {
        title: "Words",
        body: "Learn a word.",
        language: "en",
        source_url: null,
        published_at: null,
      },
    },
    "vocabulary-article-import",
  );
  const body = {
    base_revision: 0,
    word: "  Learn  ",
    article_id: article.id,
    source_version: article.content_version,
    context_sentence: "Learn a word.",
    contextual_meaning: "学习",
    part_of_speech: "verb",
    pronunciation: "/lɜːn/",
  };
  return {
    repo,
    s,
    body,
    clock: (v: string) => {
      now = new Date(v);
    },
  };
}
test("vocabulary preserves provenance, deduplicates per article and owner, and replays exact original result", async () => {
  const { s, body } = await setup();
  const result = await s.write(
    owner,
    "vocab-one",
    "add",
    body,
    "vocabulary-add-original",
  );
  assert.equal(result.entry.normalized, "learn");
  assert.equal(result.entry.contextual_meaning, "学习");
  assert.equal(result.entry.next_review, "2026-11-12");
  await assert.rejects(
    s.write(owner, "vocab-two", "add", body, "vocabulary-add-duplicate"),
    { statusCode: 409 },
  );
  await assert.rejects(
    s.write(other, "vocab-one", "add", body, "vocabulary-add-other"),
    { statusCode: 404 },
  );
  assert.equal((await s.list(other)).stats.total, 0);
  await s.write(
    owner,
    "vocab-one",
    "review",
    { base_revision: 1, feedback: "good" },
    "vocabulary-review-one",
  );
  assert.deepEqual(
    await s.write(owner, "vocab-one", "add", body, "vocabulary-add-original"),
    result,
  );
  await assert.rejects(
    s.write(
      owner,
      "vocab-one",
      "add",
      { ...body, word: "different" },
      "vocabulary-add-original",
    ),
    { statusCode: 409 },
  );
});
test("review uses legacy five-step calendar, preserves feedback and pause/archive states, and rejects stale CAS", async () => {
  const { s, body, clock } = await setup();
  await s.write(owner, "vocab-one", "add", body, "vocabulary-add-original");
  assert.equal((await s.list(owner, { filter: "due" })).items.length, 0);
  clock("2026-11-11T16:00:00Z"); // Shanghai next day
  assert.equal((await s.list(owner, { filter: "due" })).items.length, 1);
  let r = await s.write(
    owner,
    "vocab-one",
    "review",
    { base_revision: 1, feedback: "good" },
    "vocabulary-review-good",
  );
  assert.equal(r.entry.step, 1);
  assert.equal(r.entry.next_review, "2026-11-15");
  r = await s.write(
    owner,
    "vocab-one",
    "review",
    { base_revision: 2, feedback: "hard" },
    "vocabulary-review-hard",
  );
  assert.equal(r.entry.step, 1);
  r = await s.write(
    owner,
    "vocab-one",
    "review",
    { base_revision: 3, feedback: "again" },
    "vocabulary-review-again",
  );
  assert.equal(r.entry.next_review, "2026-11-13");
  await assert.rejects(
    s.write(
      owner,
      "vocab-one",
      "pause",
      { base_revision: 3, value: true },
      "vocabulary-stale-pause",
    ),
    { statusCode: 409 },
  );
  await s.write(
    owner,
    "vocab-one",
    "pause",
    { base_revision: 4, value: true },
    "vocabulary-pause-now",
  );
  await assert.rejects(
    s.write(
      owner,
      "vocab-one",
      "review",
      { base_revision: 5, feedback: "good" },
      "vocabulary-paused-review",
    ),
    { statusCode: 409 },
  );
  await s.write(
    owner,
    "vocab-one",
    "archive",
    { base_revision: 5, value: true },
    "vocabulary-archive-now",
  );
  assert.equal((await s.list(owner)).items.length, 0);
  assert.equal((await s.list(owner, { filter: "archived" })).stats.archived, 1);
  await s.write(
    owner,
    "vocab-one",
    "archive",
    { base_revision: 6, value: false },
    "vocabulary-restore-now",
  );
  await s.write(
    owner,
    "vocab-one",
    "pause",
    { base_revision: 7, value: false },
    "vocabulary-resume-now",
  );
  assert.deepEqual(
    (await s.read(owner, "vocab-one")).reviews.map((r) => [
      r.feedback,
      r.step_before,
      r.step_after,
    ]),
    [
      ["good", 0, 1],
      ["hard", 1, 1],
      ["again", 1, 0],
    ],
  );
});
test("failed receipt rolls back vocabulary/review; export, delete, tombstone replay and account erasure retain correct facts", async () => {
  const { repo, s, body } = await setup();
  await s.write(owner, "vocab-one", "add", body, "vocabulary-add-original");
  const save = repo.saveOperation;
  repo.saveOperation = async () => {
    throw Error("receipt failure");
  };
  await assert.rejects(
    s.write(
      owner,
      "vocab-one",
      "review",
      { base_revision: 1, feedback: "good" },
      "vocabulary-rollback-review",
    ),
    /receipt failure/,
  );
  repo.saveOperation = save;
  assert.equal((await s.read(owner, "vocab-one")).entry.revision, 1);
  assert.equal((await s.read(owner, "vocab-one")).reviews.length, 0);
  assert.equal(
    (await new ReadingService(repo).export(owner)).vocabulary.length,
    1,
  );
  const deleted = await s.write(
    owner,
    "vocab-one",
    "delete",
    { base_revision: 1 },
    "vocabulary-delete-original",
  );
  assert.equal(deleted.deleted, "vocab-one");
  await assert.rejects(s.read(owner, "vocab-one"), { statusCode: 404 });
  assert.deepEqual(
    await s.write(
      owner,
      "vocab-one",
      "delete",
      { base_revision: 1 },
      "vocabulary-delete-original",
    ),
    deleted,
  );
  await assert.rejects(
    s.write(owner, "vocab-one", "add", body, "vocabulary-reuse-id"),
    { statusCode: 409 },
  );
  await repo.deleteOwnerData(owner);
  assert.equal((await s.list(owner)).stats.total, 0);
  assert.equal(
    await repo.getOperation(owner, "vocabulary-add-original"),
    undefined,
  );
});
test("word pages are bounded without a library cap; stale filter cursors and revoked replays fail closed", async () => {
  const { repo, s, body, clock } = await setup();
  for (const id of ["vocab-C", "vocab-a", "vocab-B"])
    await s.write(owner, id, "add", { ...body, word: id }, "word-create-" + id);
  const page = await s.list(owner, { limit: "2" });
  assert.deepEqual(
    page.items.map((r) => r.id),
    ["vocab-B", "vocab-C"],
  );
  assert.equal(page.stats.total, 3);
  assert.deepEqual(
    (await s.list(owner, { limit: "2", cursor: page.next_cursor! })).items.map(
      (r) => r.id,
    ),
    ["vocab-a"],
  );
  clock("2026-11-12T10:00:00Z");
  const due = await s.list(owner, { filter: "due", limit: "1" });
  await s.write(
    owner,
    due.items[0].id,
    "pause",
    { base_revision: 1, value: true },
    "vocabulary-pause-cursor",
  );
  await assert.rejects(
    s.list(owner, { filter: "due", cursor: due.next_cursor! }),
    { statusCode: 409 },
  );
  await assert.rejects(s.list(owner, { limit: "101" }), { statusCode: 422 });
  const revoked = new VocabularyService(repo, async () => {
    throw Error("revoked");
  });
  await assert.rejects(revoked.list(owner), /revoked/);
  await assert.rejects(
    revoked.write(
      owner,
      "vocab-C",
      "add",
      { ...body, word: "vocab-C" },
      "word-create-vocab-C",
    ),
    /revoked/,
  );
});
