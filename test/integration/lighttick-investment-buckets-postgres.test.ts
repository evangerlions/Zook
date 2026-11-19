import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { InvestmentService } from "../../src/modules/lighttick/investments/investment.service.ts";
import { InvestmentBucketService } from "../../src/modules/lighttick/investments/buckets/bucket.service.ts";
import { exportInvestments } from "../../src/modules/lighttick/investments/ledger.export.ts";

const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (!dsn || new URL(dsn).hostname !== "127.0.0.1" || !new URL(dsn).pathname.startsWith("/grow_web_u1_"))
  throw Error("Dedicated synthetic localhost PG database required");

test("bucket migrations, immutable revisions, atomic receipt rollback and owner cleanup", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn });
  const repo = new PostgresLightTickRepository(pool);
  const owner = { appId: "lighttick" as const, userId: "bucket-pg-" + process.pid };
  const investment = new InvestmentService(repo);
  const buckets = new InvestmentBucketService(repo);
  const account = "inv-bucket-pg-account";
  try {
    const { instrument } = await investment.createInstrument(owner,
      { market: "FUND", code: "000811", kind: "fund", name: "Synthetic fund" }, "bucket-pg-instrument");
    await investment.createAccount(owner, account, {
      base_revision: 0, name: "Synthetic", baseline_date: "2026-01-01", currency: "CNY", opening_cash: "1000",
      opening_positions: [{ instrument_id: instrument.id, quantity: "100", cost: null }],
    }, "bucket-pg-account");
    const id = "inv-bucket-pg-test";
    const body = { base_revision: 0, base_account_revision: 1, buckets: [
      { id, kind: "holding", name: "Synthetic bucket", purpose: "", target_weight: "50" },
    ], allocations: [{ bucket_id: id, instrument_id: instrument.id, quantity: "99.9999999999" }] };
    const saveOperation = repo.saveOperation.bind(repo);
    repo.saveOperation = async row => { await saveOperation(row); throw Error("Synthetic receipt failure"); };
    await assert.rejects(() => buckets.write(owner, account, body, "bucket-pg-original"), /Synthetic receipt failure/);
    assert.equal((await buckets.view(owner, account)).snapshot.revision, 0);
    repo.saveOperation = saveOperation;
    const [first, second] = await Promise.all([
      buckets.write(owner, account, body, "bucket-pg-original"),
      buckets.write(owner, account, body, "bucket-pg-original"),
    ]);
    assert.deepEqual(first, second);
    const reopened = new PostgresLightTickRepository(pool);
    const service = new InvestmentBucketService(reopened);
    assert.equal((await service.view(owner, account)).holdings[0].unallocated, "0.0000000001");
    assert.deepEqual(await service.version(owner, account, 1), first);
    await assert.rejects(() => service.view({ ...owner, userId: "another-bucket-owner" }, account), { statusCode: 404 });
    const exported = await reopened.transaction(owner, () => exportInvestments(reopened, owner));
    assert.deepEqual(exported.bucket_versions, [first]);
    await reopened.deleteOwnerData(owner);
    assert.equal(await repo.investments.buckets.get(owner, account), undefined);
    assert.equal(await repo.getOperation(owner, "bucket-pg-original"), undefined);
  } finally {
    await pool.end();
  }
});
