import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { ResearchService } from "../../src/modules/lighttick/investments/research/research.service.ts";
import { researchFields } from "../../src/modules/lighttick/investments/research/research.types.ts";
import { exportResearch } from "../../src/modules/lighttick/investments/research/research.export.ts";
import { MarketWorkService } from "../../src/modules/lighttick/investments/market/market-work.service.ts";
import { MarketWorkRunner } from "../../src/modules/lighttick/investments/market/market-work.runner.ts";
import { DailyMarketAdapter } from "../../src/modules/lighttick/investments/market/market.adapter.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  !["127.0.0.1", "localhost"].includes(new URL(dsn).hostname) ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_")
)
  throw Error("Disposable synthetic localhost database required");
test("PG research has owner-CAS versions, exact snapshot provenance, crash rollback, export, reconnect and shared deletion", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    other = new PostgresLightTickRepository(pool),
    o = { appId: "lighttick" as const, userId: "research-pg-" + process.pid },
    foreign = { ...o, userId: "foreign-" + process.pid },
    clock = () => new Date("2026-11-05T08:00:00Z"),
    s = new ResearchService(repo, async () => {}, clock),
    id = "inv-research-pg-fixture";
  try {
    const i = (
      await s.createInstrument(
        o,
        { code: "600000", market: "SSE", kind: "stock", name: "Synthetic" },
        "research-pg-symbol",
      )
    ).instrument;
    const market = new MarketWorkService(
        repo,
        new InMemoryJobQueue(),
        async () => {},
        clock,
      ),
      runner = new MarketWorkRunner(
        market,
        new DailyMarketAdapter(
          async () => ({ enabled: true, revision: "synthetic" }),
          undefined,
          clock,
        ),
      );
    const work = await market.create(
      o,
      {
        instrument_id: i.id,
        base_revision: 1,
        supplier: "csv",
        start: "2026-10-30",
        end: "2026-10-30",
        declared_source: "Synthetic",
        volume_unit: "shares",
        amount_unit: "CNY",
        csv: "date,open,high,low,close,volume,amount\n2026-10-30,10,12,9,11,1,10",
      },
      "research-pg-market",
    );
    await runner.execute(o, work.id);
    const source = (await repo.investments.market.summaries(o))[0];
    assert.ok(source);
    const body = {
      base_revision: 0,
      instrument_id: i.id,
      account_id: null,
      title: "Synthetic dossier",
      horizon: "swing",
      market_sources: [
        { id: source.id, version: 1, input_digest: source.input_digest },
      ],
      evidence: [
        {
          title: "Synthetic",
          content: "  preserved\r\ntext  ",
          locator: "page 3",
          source_url: null,
          available_at: "2026-10-30T16:00:00+08:00",
          contrary_evidence: "unknown",
        },
      ],
      ...Object.fromEntries(researchFields.map((k) => [k, ""])),
    };
    const save = repo.saveOperation.bind(repo);
    repo.saveOperation = async () => {
      throw Error("receipt crash");
    };
    await assert.rejects(s.write(o, id, body, "research-pg-original"));
    repo.saveOperation = save;
    assert.equal(await other.investments.research.get(o, id), undefined);
    assert.equal(
      (await other.investments.research.versions(o, id, 101, 10)).length,
      0,
    );
    const first = await s.write(o, id, body, "research-pg-original");
    assert.deepEqual(await new ResearchService(other).readEntry(o, id), first);
    assert.equal(first.evidence[0].content, body.evidence[0].content);
    const change = { ...body, base_revision: 1, title: "Concurrent" };
    const both = await Promise.allSettled([
      s.write(o, id, change, "research-pg-left"),
      new ResearchService(other).write(o, id, change, "research-pg-right"),
    ]);
    assert.equal(both.filter((r) => r.status === "fulfilled").length, 1);
    assert.deepEqual(await s.write(o, id, body, "research-pg-original"), first);
    assert.equal((await s.history(o, id)).items.length, 2);
    await assert.rejects(s.readEntry(foreign, id), { statusCode: 404 });
    const wrong = {
      ...body,
      base_revision: 2,
      market_sources: [
        { ...body.market_sources[0], input_digest: "f".repeat(64) },
      ],
    };
    await assert.rejects(s.write(o, id, wrong, "research-pg-bad-source"), {
      statusCode: 404,
    });
    const exported = await repo.transaction(o, () => exportResearch(repo, o));
    assert.equal(exported.versions.length, 2);
    assert.deepEqual(
      exported.receipts.find((r) => r.revision === 1)?.request_body,
      body,
    );
    assert.deepEqual((await exportResearch(repo, foreign)).entries, []);
    await repo.deleteOwnerData(o);
    assert.equal((await other.investments.research.list(o)).length, 0);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM zook_lighttick_investment_research_versions WHERE user_id=$1",
          [o.userId],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await repo.deleteOwnerData(o);
    await pool.end();
  }
});
