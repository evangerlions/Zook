import {exportReview} from "../../src/modules/lighttick/knowledge/review.export.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { KnowledgeService } from "../../src/modules/lighttick/knowledge/knowledge.service.ts";
import { ReviewService } from "../../src/modules/lighttick/knowledge/review.service.ts";
import { LightTickRecordService } from "../../src/modules/lighttick/lighttick-record.service.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  !["127.0.0.1", "localhost"].includes(new URL(dsn).hostname) ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_")
)
  throw Error("Disposable synthetic localhost database required");
test("PostgreSQL knowledge history/receipts, bulk source authorization and review facts survive reconnect and roll back atomically", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    other = new PostgresLightTickRepository(pool),
    o = { appId: "lighttick" as const, userId: "knowledge-pg-" + process.pid },
    k = new KnowledgeService(repo),
    review = new ReviewService(other),
    records = new LightTickRecordService(repo),
    native = new NativeLearningService(repo, true);
  const id = "knowledge-pg-fixture",
    source = { kind: "record" as const, id: "record-pg-fixture", version: "1" },
    b = {
      base_revision: 0,
      kind: "knowledge",
      title: "Synthetic knowledge",
      body: "Version one content",
      tags: [],
      sources: [source],
    };
  try {
    await records.mutate(
      o,
      source.id,
      "save",
      {
        base_version: 0,
        raw_text: "Recorded facts",
        record_date: "2026-11-04",
        prompt_kind: "free",
        guided_answers: {},
        tags: [],
      },
      "knowledge-pg-record",
    );
    const first = await k.mutate(o, id, "save", b, "knowledge-pg-original");
    assert.deepEqual(
      await new KnowledgeService(other).mutate(
        o,
        id,
        "save",
        b,
        "knowledge-pg-original",
      ),
      first,
    );
    const save = repo.saveOperation.bind(repo);
    repo.saveOperation = async () => {
      throw Error("Crash before receipt");
    };
    await assert.rejects(
      k.mutate(
        o,
        id,
        "save",
        { ...b, base_revision: 1, body: "Failed copy" },
        "knowledge-pg-crash",
      ),
    );
    repo.saveOperation = save;
    assert.equal((await other.knowledge.get(o, id))!.revision, 1);
    assert.equal((await other.knowledge.history(o, id, 99, 10)).length, 1);
    assert.deepEqual(
      await other.knowledge.availableSources(o, [
        source,
        { ...source, id: "record-missing" },
      ]),
      [JSON.stringify(["record", source.id, "1"])],
    );
    await native.saveCollection(
      o,
      "pg-review-course",
      { base_revision: 0, title: "PG course", archived: false },
      "pg-review-collection",
    );
    const l = await native.publish(
      o,
      "lesson-pg-review",
      {
        base_revision: 0,
        collection_id: "pg-review-course",
        number: 1,
        title: "PG lesson",
        content: "Synthetic course body",
        references: "",
        source_url: "",
      },
      "pg-review-publication",
    );
    await native.privateCommand(
      o,
      l.id,
      {
        action: "save",
        content_version: l.content_version,
        base_revision: 0,
        notes: "Saved private note",
        answers: [],
      },
      "pg-review-note",
    );
    let s = await review.snapshot(o, { limit: "1" });
    assert.equal(s.counts.knowledge, 1);
    assert.equal(s.counts.lesson, 1);
    assert.equal(s.counts.learning_notes, 1);
    assert.ok(s.next_cursor);
    await native.privateCommand(
      o,
      l.id,
      {
        action: "complete",
        content_version: l.content_version,
        base_revision: 0,
      },
      "pg-review-complete",
    );
    await assert.rejects(review.snapshot(o, { cursor: s.next_cursor! }), {
      code: "LIGHTTICK_REVIEW_CURSOR_EXPIRED",
    });
    s = await review.snapshot(o);
    assert.equal(s.counts.lesson_completed, 1);
    const exported=JSON.parse((await exportReview(other,o,async()=>{})).content);assert.equal(exported.learning.publications.length,1);assert.equal(exported.learning.states[0].notes,'Saved private note');assert.equal(exported.knowledge[0].versions.length,1);
    await records.mutate(
      o,
      source.id,
      "archive",
      { base_version: 1 },
      "pg-review-source-archive",
    );
    assert.equal((await review.snapshot(o)).counts.knowledge, 0);
    const a = (await native.authority(o))!;
    await native.consent(
      o,
      {
        base_revision: a.revision,
        reading_enabled: false,
        private_enabled: false,
      },
      "pg-review-revoke",
    );
    assert.equal((await review.snapshot(o)).total, 0);
    const withdrawn=JSON.parse((await exportReview(other,o,async()=>{})).content);assert.equal(withdrawn.learning,null);assert.equal(withdrawn.knowledge.length,0);assert.equal(withdrawn.records.length,1,'archived owner record is retained in explicit owner export');
    await assert.rejects(k.mutate(o, id, "save", b, "knowledge-pg-original"), {
      statusCode: 403,
    });
    await repo.deleteOwnerData(o);
    assert.equal(await other.knowledge.get(o, id), undefined);
    assert.equal((await other.knowledge.history(o, id, 99, 10)).length, 0);
  } finally {
    await repo.deleteOwnerData(o);
    await pool.end();
  }
});
