import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { PortfolioService } from "../../src/modules/lighttick/investments/portfolio/portfolio.service.ts";
import { PortfolioRunner } from "../../src/modules/lighttick/investments/portfolio/portfolio.runner.ts";
import { ledgerCorrectionFixture } from "../support/lighttick-ledger-correction-fixture.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (!dsn || new URL(dsn).hostname !== "127.0.0.1" || !new URL(dsn).pathname.startsWith("/grow_web_u1_"))
    throw Error("Dedicated synthetic localhost PG database required");
test("PG portfolio NUMERIC NAV, baseline history and preview/adoption receipts survive rollback, recovery, reconnect and shared deletion", async () => {
    await runPostgresMigrations({ connectionString: dsn, log: () => { } });
    await runPostgresMigrations({ connectionString: dsn, log: () => { } });
    const pool = new Pool({ connectionString: dsn }), repo = new PostgresLightTickRepository(pool);
    let now = new Date("2026-11-08T08:00:00Z");
    try {
        const f = await ledgerCorrectionFixture(repo, "synthetic-portfolio-pg-" + process.pid), s = new PortfolioService(repo, f.q, async () => { }, () => now), runner = new PortfolioRunner(s);
        const instrument = (await f.s.createInstrument(f.o, { code: "000777", name: "Synthetic NAV", kind: "fund", market: "FUND" }, "portfolio-fund-instrument")).instrument;
        const fact = await s.writeFact(f.o, f.id, "inv-portfolio-nav-source", { base_revision: 0, base_account_revision: 1, kind: "fund_nav", instrument_id: instrument.id, date: "2026-10-26", nav: "10.1234567891", source_label: "Synthetic verified NAV" }, "portfolio-original-nav");
        const numeric = await pool.query("SELECT nav::text,payload FROM zook_lighttick_portfolio_facts WHERE user_id=$1 AND id=$2", [f.o.userId, fact.id]);
        assert.equal(numeric.rows[0].nav, "10.1234567891");
        assert.equal("nav" in numeric.rows[0].payload, false);
        const body = { kind: "baseline", base_revision: 2, reason: "Synthetic precise baseline", baseline: { name: "Synthetic corrected", currency: "CNY", baseline_date: "2026-01-01", opening_cash: "9007199254740993.0000000001", opening_positions: [{ instrument_id: instrument.id, quantity: "100", cost: "900" }] } };
        const w = await s.create(f.o, f.id, body, "portfolio-original-baseline-work");
        await runner.execute(f.o, w.id);
        const preview = await s.readWork(f.o, f.id, w.id);
        assert.equal(preview.status, "succeeded");
        const adopt = { base_revision: 2, preview_digest: (preview.output as any).preview_digest };
        const publish = repo.investments.portfolio.publish.bind(repo.investments.portfolio);
        repo.investments.portfolio.publish = async (o, v) => { await publish(o, v); throw Error("Synthetic crash after adoption publication"); };
        await assert.rejects(() => s.adopt(f.o, f.id, w.id, adopt, "portfolio-original-baseline-adopt"), /Synthetic crash/);
        assert.equal((await repo.investments.account(f.o, f.id))!.baseline_version, 1);
        assert.equal((await repo.investments.baselines(f.o, f.id)).length, 1);
        assert.equal((await repo.investments.portfolio.saved(f.o, f.id)).length, 0);
        repo.investments.portfolio.publish = publish;
        const saved = await s.adopt(f.o, f.id, w.id, adopt, "portfolio-original-baseline-adopt");
        assert.equal((await s.adopt(f.o, f.id, w.id, adopt, "portfolio-original-baseline-adopt")).id, saved.id);
        const reopened = new PostgresLightTickRepository(pool);
        assert.equal((await reopened.investments.account(f.o, f.id))!.baseline_version, 2);
        assert.equal((await reopened.investments.baselines(f.o, f.id))[0].opening_cash, "9007199254740993.0000000001");
        assert.equal((await f.l.ledger(f.o, f.id, "", 100, "2")).report!.baseline_version, 2);
        const value = await s.create(f.o, f.id, { kind: "valuation", base_revision: 3, date: "2026-10-26", sources: {} }, "portfolio-original-valuation-work");
        const save = repo.investments.portfolio.saveWork.bind(repo.investments.portfolio);
        repo.investments.portfolio.saveWork = async (v, base) => { await save(v, base); if (v.status === "succeeded")
            throw Error("Synthetic terminal crash"); };
        await assert.rejects(() => runner.execute(f.o, value.id), /Synthetic terminal/);
        assert.equal((await s.readWork(f.o, f.id, value.id)).status, "running");
        repo.investments.portfolio.saveWork = save;
        now = new Date(now.getTime() + 60001);
        await new PortfolioRunner(s).recover();
        await runner.execute(f.o, value.id);
        const terminal = await s.readWork(f.o, f.id, value.id);
        assert.equal(terminal.status, "succeeded");
        assert.equal((terminal.output as any).balance.equity, "9007199254742005.3456789101");
        assert.equal((await s.create(f.o, f.id, body, "portfolio-original-baseline-work")).id, w.id);
        await repo.deleteOwnerData(f.o);
        for (const table of ["portfolio_facts", "portfolio_versions", "portfolio_work", "portfolio_saved", "investment_baselines"])
            assert.equal((await pool.query(`SELECT count(*)::int AS n FROM zook_lighttick_${table} WHERE user_id=$1`, [f.o.userId])).rows[0].n, 0);
    }
    finally {
        await pool.end();
    }
});
