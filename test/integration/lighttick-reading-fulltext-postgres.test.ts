import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { ReadingWorkService } from "../../src/modules/lighttick/reading/reading-work.service.ts";
import { ReadingWorkRunner } from "../../src/modules/lighttick/reading/reading-work.runner.ts";
import { ReadingService } from "../../src/modules/lighttick/reading/reading.service.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { readingPdfFixture } from "../support/reading-pdf-fixture.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  !["localhost", "127.0.0.1"].includes(new URL(dsn).hostname) ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_")
)
  throw Error("Disposable localhost Grow database required");
test("real PG retains exact PDF binary and 500000-character versions across reconnect, export and account cleanup", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    owner = { appId: "lighttick" as const, userId: "pdf-pg-" + process.pid },
    work = new ReadingWorkService(repo, new InMemoryJobQueue()),
    reading = new ReadingService(repo),
    bytes = readingPdfFixture();
  try {
    const created = await work.create(
      owner,
      {
        kind: "collect_url",
        title: "PDF PG source",
        url: "https://example.com/pdf",
      },
      "pdf-pg-original",
    );
    await new ReadingWorkRunner(
      work,
      {
        complete: async () => {
          throw Error("No model");
        },
      } as any,
      async () => ({
        body: bytes.toString("base64"),
        encoding: "base64",
        content_type: "application/pdf",
      }),
    ).execute(owner, created.id);
    const fresh = new ReadingWorkService(
        new PostgresLightTickRepository(pool),
        new InMemoryJobQueue(),
      ),
      done = await fresh.read(owner, created.id);
    assert.equal(done.status, "succeeded");
    assert.ok(Buffer.from(done.output!.document!.body, "base64").equals(bytes));
    const imported = await fresh.adopt(
      owner,
      done.id,
      {
        base_revision: done.revision,
        output_digest: done.output_digest,
        index: 0,
        base_article_revision: null,
      },
      "pdf-pg-adopt",
    );
    assert.ok(
      (await reading.read(owner, imported.article_id)).content.body.includes(
        "Synthetic PDF text",
      ),
    );
    const maximum = await reading.write(
      owner,
      "article-long-pg",
      "import",
      {
        base_revision: 0,
        content: {
          title: "Maximum",
          body: "x".repeat(500000),
          source_url: null,
          language: "en",
          published_at: null,
        },
      },
      "pdf-pg-long",
    );
    assert.equal(
      (
        await new ReadingService(new PostgresLightTickRepository(pool)).read(
          owner,
          maximum.id,
        )
      ).content.body.length,
      500000,
    );
    const exported = await reading.export(owner);
    assert.equal(exported.articles.length, 2);
    assert.equal(exported.work[0].output!.document!.encoding, "base64");
    assert.ok(
      Buffer.from(exported.work[0].output!.document!.body, "base64").equals(
        bytes,
      ),
    );
  } finally {
    await repo.deleteOwnerData(owner);
    assert.equal((await work.list(owner)).items.length, 0);
    await pool.end();
  }
});
