import {exerciseReadingErasure,erasureOwner} from "../support/reading-erasure-acceptance.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { VocabularyService } from "../../src/modules/lighttick/reading/vocabulary.service.ts";
import { ReadingService } from "../../src/modules/lighttick/reading/reading.service.ts";
const connectionString = process.env.LIGHTTICK_READING_TEST_DATABASE_URL;
if (
  !connectionString ||
  !["localhost","127.0.0.1"].includes(new URL(connectionString).hostname) ||
  !/^(?:lighttick_full_migration_[0-9]+|grow_web_u1_content_completion_[0-9]+)$/.test(
    new URL(connectionString).pathname.slice(1),
  )
)
  throw Error("Dedicated lighttick_full_migration_<date> database required.");
test("reading PG migrations, literal search, CAS, rollback, restart and owner deletion", async () => {
  await runPostgresMigrations({ connectionString, log: () => {} });
  const pool = new Pool({ connectionString });
  const owner = { appId: "lighttick", userId: "reading-pg-synthetic" } as const;
  const other = { appId: "lighttick", userId: "reading-pg-other" } as const;
  const repo = new PostgresLightTickRepository(pool);
  const s = new ReadingService(repo);
  const id = "article-pg-synthetic";
  const body = {
    base_revision: 0,
    content: {
      title: "Literal % _",
      author: "合成作者唯一",
      tags: ["literal % _ tag", "研究标签"],
      body: "原文\n  exact bytes ",
      source_url: null,
      language: "zh",
      published_at: null,
    },
  };
  try {
    await repo.deleteOwnerData(owner);
    await repo.deleteOwnerData(other);
    const imported = await s.write(
      owner,
      id,
      "import",
      body,
      "reading-pg-original",
    );
    assert.equal((await s.list(owner, { search: "% _" })).items.length, 1);
    assert.equal((await s.list(owner, { search: "%missing" })).items.length, 0);
    assert.equal((await s.list(other)).items.length, 0);
    assert.equal(
      (await s.list(owner, { search: "合成作者唯一" })).items.length,
      1,
    );
    assert.equal((await s.list(owner, { search: "研究标签" })).items.length, 1);
    const command = {
      base_revision: 1,
      content_version: imported.content_version,
      personal: {
        notes: "保存笔记",
        feedback: "",
        bookmark: true,
        later: false,
        read: false,
      },
    };
    const result = await Promise.allSettled([
      s.write(owner, id, "personal", command, "reading-pg-first"),
      s.write(
        owner,
        id,
        "personal",
        { ...command, personal: { ...command.personal, notes: "competing" } },
        "reading-pg-second",
      ),
    ]);
    assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await s.history(owner, id)).items.length, 2);
    assert.deepEqual(
      await s.write(owner, id, "import", body, "reading-pg-original"),
      imported,
    );
    await assert.rejects(
      repo.transaction(owner, async () => {
        await s.write(
          owner,
          "article-pg-rollback",
          "import",
          {...body,import_decision:{scope_digest:(await s.previewImport(owner,{content:body.content})).digest,mode:"independent",article_id:null}},
          "reading-pg-rollback",
        );
        throw Error("force rollback");
      }),
      /force rollback/,
    );
    await assert.rejects(s.read(owner, "article-pg-rollback"), {
      statusCode: 404,
    });
    const restarted = new ReadingService(new PostgresLightTickRepository(pool));
    assert.equal(
      (await restarted.export(owner)).sha256,
      (await s.export(owner)).sha256,
    );
    const snapshot = await restarted.read(owner, id);
    await s.write(
      owner,
      id,
      "archive",
      { base_revision: snapshot.revision },
      "reading-pg-archive",
    );
    assert.equal((await s.list(owner)).items.length, 0);
    assert.equal((await s.list(owner, { filter: "archived" })).items.length, 1);
    const vocabulary = new VocabularyService(repo);
    const word = {
      base_revision: 0,
      word: "literal",
      article_id: id,
      source_version: imported.content_version,
    };
    // Article is archived above: reject new words until explicitly restored.
    await assert.rejects(
      vocabulary.write(owner, "vocab-pg-one", "add", word, "vocabulary-pg-add"),
      { statusCode: 404 },
    );
    await s.write(
      owner,
      id,
      "restore",
      { base_revision: snapshot.revision + 1 },
      "reading-pg-restore",
    );
    await vocabulary.write(
      owner,
      "vocab-pg-one",
      "add",
      word,
      "vocabulary-pg-add",
    );
    const reviews = await Promise.allSettled([
      vocabulary.write(
        owner,
        "vocab-pg-one",
        "review",
        { base_revision: 1, feedback: "good" },
        "vocabulary-pg-review-one",
      ),
      vocabulary.write(
        owner,
        "vocab-pg-one",
        "review",
        { base_revision: 1, feedback: "again" },
        "vocabulary-pg-review-two",
      ),
    ]);
    assert.equal(reviews.filter((r) => r.status === "fulfilled").length, 1);
    const durable = new VocabularyService(
      new PostgresLightTickRepository(pool),
    );
    assert.equal((await durable.read(owner, "vocab-pg-one")).reviews.length, 1);
    await assert.rejects(
      repo.transaction(owner, async () => {
        await vocabulary.write(
          owner,
          "vocab-pg-one",
          "review",
          { base_revision: 2, feedback: "hard" },
          "vocabulary-pg-rollback",
        );
        throw Error("rollback vocabulary");
      }),
      /rollback vocabulary/,
    );
    assert.equal((await durable.read(owner, "vocab-pg-one")).entry.revision, 2);
    assert.equal((await restarted.export(owner)).vocabulary.length, 1);
    await durable.write(
      owner,
      "vocab-pg-one",
      "delete",
      { base_revision: 2 },
      "vocabulary-pg-delete",
    );
    assert.equal((await durable.list(owner)).stats.total, 0);
    await assert.rejects(
      durable.write(
        owner,
        "vocab-pg-one",
        "add",
        word,
        "vocabulary-pg-reused-id",
      ),
      { statusCode: 409 },
    );
    await durable.write(
      owner,
      "vocab-pg-two",
      "add",
      word,
      "vocabulary-pg-second-word",
    );
    const current = await s.read(owner, id);
    const material = {
      content_version: current.content_version,
      kind: "summary",
      paragraph_id: null,
    };
    await s.write(
      owner,
      id,
      "draft",
      { ...material, base_revision: current.revision, text: "PG review draft" },
      "material-pg-draft",
    );
    await s.write(
      owner,
      id,
      "adopt",
      { ...material, base_revision: current.revision + 1, draft_version: 1 },
      "material-pg-adopt",
    );
    assert.equal(
      (await restarted.read(owner, id)).materials![0].adopted!.text,
      "PG review draft",
    );
    assert.equal(
      (await restarted.history(owner, id)).items[1].materials![0].adopted,
      null,
    );
    await repo.deleteOwnerData(owner);
    assert.equal((await durable.list(owner)).stats.total, 0);
    assert.equal(
      await repo.reading.vocabularyIdUsed(owner, "vocab-pg-one"),
      false,
    );
    assert.equal((await s.list(owner, { filter: "archived" })).items.length, 0);
    await assert.rejects(s.receipt(owner, "reading-pg-original"), {
      statusCode: 404,
    });
  } finally {
    await pool.end();
  }
});

test("reading erasure PG atomic rollback, shared capture cleanup, tombstones, owner references and reconnect",async()=>{
 await runPostgresMigrations({connectionString,log:()=>{}});const pool=new Pool({connectionString}),repo=new PostgresLightTickRepository(pool),other={...erasureOwner,userId:"reading-erasure-other"};
 try{await repo.deleteOwnerData(erasureOwner);await repo.deleteOwnerData(other);const result=await exerciseReadingErasure(repo);const reconnected=new PostgresLightTickRepository(pool);assert.equal((await reconnected.readingErasure.tombstone(erasureOwner,result.target))!.deleted,true);
 const raw=await pool.query("SELECT count(*)::int AS n FROM zook_lighttick_operations WHERE app_id=$1 AND user_id=$2 AND entity_type IN ('reading_article','reading_vocabulary','reading_work') AND (request_payload::text LIKE '%PRIVATE NOTES%' OR result_payload::text LIKE '%PRIVATE NOTES%' OR request_payload::text LIKE '%PRIOR DELETED WORD%' OR result_payload::text LIKE '%PRIOR DELETED WORD%')",[erasureOwner.appId,erasureOwner.userId]);assert.equal(raw.rows[0].n,0);
 await repo.deleteOwnerData(erasureOwner);assert.equal(await reconnected.readingErasure.tombstone(erasureOwner,result.target),undefined);
 }finally{await repo.deleteOwnerData(erasureOwner);await repo.deleteOwnerData(other);await pool.end();}
});
