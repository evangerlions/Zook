import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { InvestmentService } from "../../src/modules/lighttick/investments/investment.service.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  !["localhost", "127.0.0.1"].includes(new URL(dsn).hostname) ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_")
)
  throw Error("Disposable synthetic localhost database required");
test("PostgreSQL baseline amounts are numeric and survive reconnect, failed receipt rollback, archive and owner deletion", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    other = new PostgresLightTickRepository(pool),
    o = {
      appId: "lighttick" as const,
      userId: "investments-pg-" + process.pid,
    },
    s = new InvestmentService(repo),
    id = "inv-account-pg-fixture";
  try {
    const i = await s.createInstrument(
        o,
        {
          code: "000001.SZ",
          market: "SZSE",
          kind: "stock",
          name: "Synthetic instrument",
        },
        "investment-pg-instrument",
      ),
      b = {
        base_revision: 0,
        name: "Synthetic baseline",
        currency: "CNY",
        baseline_date: "2026-11-04",
        opening_cash: "999999999999999999.9999999999",
        opening_positions: [
          {
            instrument_id: i.instrument.id,
            quantity: "0.0000000001",
            cost: null,
          },
        ],
      };
    const save = repo.saveOperation.bind(repo);
    repo.saveOperation = async () => {
      throw Error("Synthetic receipt crash");
    };
    await assert.rejects(s.createAccount(o, id, b, "investment-pg-account"));
    repo.saveOperation = save;
    assert.equal(await other.investments.account(o, id), undefined);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM zook_lighttick_investment_baselines WHERE user_id=$1",
          [o.userId],
        )
      ).rows[0].n,
      0,
    );
    const account = await s.createAccount(o, id, b, "investment-pg-account");
    assert.deepEqual(
      await new InvestmentService(other).read(o, "accounts", id),
      account,
    );
    assert.deepEqual(
      await new InvestmentService(other).createAccount(
        o,
        id,
        b,
        "investment-pg-account",
      ),
      account,
    );
    const row = (
      await pool.query(
        "SELECT pg_typeof(opening_cash)::text AS kind,opening_cash::text AS amount FROM zook_lighttick_investment_baselines WHERE app_id=$1 AND user_id=$2",
        [o.appId, o.userId],
      )
    ).rows[0];
    assert.equal(row.kind, "numeric");
    assert.equal(row.amount, b.opening_cash);
    await s.archiveAccount(
      o,
      id,
      { base_revision: 1, archived: true },
      "investment-pg-archive",
    );
    assert.equal((await other.investments.account(o, id))!.archived, true);
    await repo.deleteOwnerData(o);
    assert.equal(await other.investments.account(o, id), undefined);
    assert.equal(
      await other.investments.instrument(o, i.instrument.id),
      undefined,
    );
  } finally {
    await repo.deleteOwnerData(o);
    await pool.end();
  }
});
