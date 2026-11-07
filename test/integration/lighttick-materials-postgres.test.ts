import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { MaterialService } from "../../src/modules/lighttick/investments/materials/material.service.ts";
import { ResearchService } from "../../src/modules/lighttick/investments/research/research.service.ts";
import { researchFields } from "../../src/modules/lighttick/investments/research/research.types.ts";
import { exportInvestments } from "../../src/modules/lighttick/investments/ledger.export.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  !["127.0.0.1", "localhost"].includes(new URL(dsn).hostname) ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_")
)
  throw Error("Dedicated synthetic localhost database required");
test("PG independent materials preserve versions/CAS/original receipts, source relations and shared deletion after reconnect", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    other = new PostgresLightTickRepository(pool),
    o = { appId: "lighttick" as const, userId: "material-pg-" + process.pid },
    s = new MaterialService(repo),
    r = new ResearchService(repo),
    id = "inv-material-pg-fixture",
    b = {
      base_revision: 0,
      title: "Source",
      content: "  original\r\n source  ",
      locator: "p1",
      source_url: null,
      available_at: "2026-10-01T00:00:00Z",
      contrary_evidence: "assumptions",
    };
  try {
    const m = await s.write(o, id, b, "material-original"),
      i = (
        await r.createInstrument(
          o,
          { market: "SSE", code: "600000", kind: "stock", name: "Synthetic" },
          "symbol-original",
        )
      ).instrument,
      rb = {
        base_revision: 0,
        instrument_id: i.id,
        account_id: null,
        title: "Dossier",
        horizon: "short",
        evidence: [],
        market_sources: [],
        material_sources: [
          { id, version: 1, content_digest: m.content_digest },
        ],
        ...Object.fromEntries(researchFields.map((k) => [k, ""])),
      };
    for (const rid of [
      "inv-material-pg-research-one",
      "inv-material-pg-research-two",
    ])
      await r.write(o, rid, rb, "save-" + rid);
    const race = await Promise.allSettled(
      [s, new MaterialService(other)].map((service, j) =>
        service.write(
          o,
          id,
          { ...b, base_revision: 1, content: "New " + j },
          "race-original-" + j,
        ),
      ),
    );
    assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await s.history(o, id)).items.length, 2);
    assert.equal((await s.readMaterial(o, id, 1)).content, b.content);
    const save = repo.saveOperation.bind(repo);
    repo.saveOperation = async () => {
      throw Error("receipt crash");
    };
    await assert.rejects(
      s.write(o, id, { ...b, base_revision: 2 }, "crash-original"),
    );
    repo.saveOperation = save;
    assert.equal((await s.readMaterial(o, id)).revision, 2);
    assert.equal(await repo.getOperation(o, "crash-original"), undefined);
    assert.equal((await s.history(o, id)).items.length, 2);
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve)),
      barrier = new Promise<void>((resolve) => (release = resolve));
    const archive = repo.transaction(o, async () => {
      await s.archive(o, id, { base_revision: 2 }, "archive-original", true);
      entered();
      await barrier;
    });
    await started;
    let settled = false;
    const late = new ResearchService(other)
      .write(o, "inv-material-pg-late-research", rb, "late-reference-original")
      .finally(() => {
        settled = true;
      });
    const rejected = assert.rejects(late, { statusCode: 409 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(settled, false);
    release();
    await archive;
    await rejected;
    assert.equal(
      await other.getOperation(o, "late-reference-original"),
      undefined,
    );
    const restart = new MaterialService(new PostgresLightTickRepository(pool));
    assert.equal((await restart.references(o, id)).items.length, 2);
    assert.deepEqual(await restart.write(o, id, b, "material-original"), m);
    assert.equal((await restart.readMaterial(o, id, 1)).content, b.content);
    const refs = await restart.references(o, id, "", 1);
    assert.ok(refs.next_cursor);
    assert.equal(
      (await restart.references(o, id, refs.next_cursor!, 1)).items.length,
      1,
    );
    await assert.rejects(
      restart.readMaterial({ ...o, userId: "foreign" }, id),
      { statusCode: 404 },
    );
    const exported = await repo.transaction(o, () =>
      exportInvestments(repo, o),
    );
    assert.equal(exported.materials!.versions.length, 3);
    assert.equal(exported.materials!.receipts.length, 3);
    assert.equal(exported.research.entries[0].material_sources![0].version, 1);
    await restart.archive(
      o,
      id,
      { base_revision: 3 },
      "restore-original",
      false,
    );
    await new ResearchService(other).write(
      o,
      "inv-material-pg-late-research",
      rb,
      "late-reference-original",
    );
    assert.equal((await restart.references(o, id)).items.length, 3);
    await other.deleteOwnerData(o);
    for (const table of [
      "investment_materials",
      "investment_material_versions",
      "investment_research",
      "investment_research_versions",
    ])
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM zook_lighttick_" +
              table +
              " WHERE user_id=$1",
            [o.userId],
          )
        ).rows[0].n,
        0,
      );
  } finally {
    await other.deleteOwnerData(o);
    await pool.end();
  }
});
