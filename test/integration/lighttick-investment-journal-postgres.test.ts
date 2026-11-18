import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { InvestmentJournalService } from "../../src/modules/lighttick/investments/journal/journal.service.ts";
import { InvestmentService } from "../../src/modules/lighttick/investments/investment.service.ts";

const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (!dsn || new URL(dsn).hostname !== "127.0.0.1" || !new URL(dsn).pathname.startsWith("/grow_web_u1_"))
  throw Error("Dedicated synthetic localhost PG database required");

test("journal migration, atomic revision writes, reconnect and shared deletion", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn });
  const repo = new PostgresLightTickRepository(pool);
  const owner = { appId: "lighttick" as const, userId: "synthetic-journal-pg-" + process.pid };
  const options = [async () => {}, () => new Date("2026-11-17T16:05:00Z")] as const;
  const service = new InvestmentJournalService(repo, ...options);
  try {
    const { instrument } = await new InvestmentService(repo, ...options).createInstrument(owner,
      { market: "SSE", kind: "stock", code: "600001", name: "Synthetic PG equity" }, "journal-pg-symbol");
    await service.follow(owner, instrument.id, { following: true }, "journal-pg-follow");
    const body = { base_revision: 0, instrument_id: instrument.id, action: "watch", reason: "Await evidence", review_on: "2026-11-18" };
    const id = "inv-journal-pg-decision";

    const saveOperation = repo.saveOperation.bind(repo);
    repo.saveOperation = async row => { await saveOperation(row); throw Error("Synthetic failure after receipt write"); };
    await assert.rejects(() => service.saveDecision(owner, id, body, "journal-pg-original"), /Synthetic failure/);
    assert.equal((await repo.investments.journal.get(owner))?.decisions[id], undefined);
    repo.saveOperation = saveOperation;

    const entries = await Promise.all([
      service.saveDecision(owner, id, body, "journal-pg-original"),
      service.saveDecision(owner, id, body, "journal-pg-original"),
    ]);
    assert.deepEqual(entries[0], entries[1]);
    const reopened = new PostgresLightTickRepository(pool);
    const otherService = new InvestmentJournalService(reopened, ...options);
    assert.equal((await otherService.dashboard(owner)).reviews_due[0].id, id);
    assert.equal((await otherService.decision(owner, id)).revisions.length, 1);
    assert.equal((await otherService.dashboard({ ...owner, userId: "different-owner" })).watchlist.length, 0);
    await reopened.deleteOwnerData(owner);
    assert.equal(await repo.investments.journal.get(owner), undefined);
    assert.equal(await repo.getOperation(owner, "journal-pg-original"), undefined);
  } finally {
    await pool.end();
  }
});
