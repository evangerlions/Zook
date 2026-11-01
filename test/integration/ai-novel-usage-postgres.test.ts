import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { PostgresAiNovelCreditsStore } from "../../src/infrastructure/database/postgres/postgres-ai-novel-credits.ts";
import { AiNovelCreditsService } from "../../src/modules/ai-novel/credits/ai-novel-credits.service.ts";
import { buildUsageReport } from "../../src/modules/admin/ai-novel-usage-report.ts";

const databaseUrl = process.env.AINOVEL_CREDITS_TEST_DATABASE_URL?.trim();
test(
  "PostgreSQL usage evidence shares debit transaction, double migration preserves start, immutable ledger rollback and report reads",
  { skip: !databaseUrl },
  async () => {
    const schema = `usage_test_${randomBytes(8).toString("hex")}`;
    const pool = new Pool({ connectionString: databaseUrl });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    const connect = async () => {
      const c = await pool.connect();
      await c.query(`SET search_path TO "${schema}"`);
      return c;
    };
    try {
      const c = await connect();
      try {
        for (const file of [
          "072_ai_novel_credits.sql",
          "075_ai_novel_usage_reporting.sql",
        ])
          await c.query(
            await readFile(
              new URL(
                `../../src/infrastructure/database/postgres/migrations/${file}`,
                import.meta.url,
              ),
              "utf8",
            ),
          );
        const before = (
          await c.query(
            "SELECT started_at FROM zook_ai_novel_credit_reporting_metadata",
          )
        ).rows[0].started_at;
        await c.query(
          await readFile(
            new URL(
              "../../src/infrastructure/database/postgres/migrations/075_ai_novel_usage_reporting.sql",
              import.meta.url,
            ),
            "utf8",
          ),
        );
        assert.equal(
          (
            await c.query(
              "SELECT started_at FROM zook_ai_novel_credit_reporting_metadata",
            )
          ).rows[0].started_at.toISOString(),
          before.toISOString(),
        );
        // Minimal isolated payment-evidence fixture; not a shared or production schema.
        await c.query(`CREATE TABLE zook_ai_novel_billing_transactions(app_id text,user_id text,provider_transaction_id text,
        product_key text,is_sandbox boolean,currency text,purchased_at timestamptz,refunded_at timestamptz,
        amount_minor bigint,refund_amount_minor bigint,status text)`);
        await c.query(`INSERT INTO zook_ai_novel_billing_transactions VALUES
        ('ai_novel','user','paid','plus_monthly',false,'CNY','2026-10-01','2026-10-03',3900,1950,'refunded'),
        ('ai_novel','user','pending','plus_monthly',false,'CNY','2026-10-01',null,9900,null,'pending'),
        ('ai_novel','other','sandbox','pro_monthly',true,'USD','2026-10-01',null,9999,null,'provider_paid')`);
      } finally {
        c.release();
      }
      const store = new PostgresAiNovelCreditsStore(connect);
      let now = new Date("2026-10-01T00:00:00.000Z");
      const service = new AiNovelCreditsService(
        store,
        async () => "free",
        undefined,
        () => now,
      );
      const receipt = {
        callId: "call",
        modelKey: "model",
        pointMicros: "1000000",
        usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 },
        pricing: {
          inputPointsPerMillionTokens: 100,
          outputPointsPerMillionTokens: 100,
        },
      };
      await service.begin("user", "job", "request");
      await service.record("user", "job", "request", receipt);
      await service.record("user", "job", "request", receipt);
      await service.releaseRequest("user", "job", "request");
      await service.begin("user", "retry-other-job", "request2");
      // Same call ID in another job cannot produce a second debit if ledger insert fails.
      await assert.rejects(
        service.record("user", "retry-other-job", "request2", receipt),
        /duplicate key/,
      );
      await service.closeRequest(
        "user",
        "retry-other-job",
        "request2",
        "failure",
      );
      assert.equal(
        (await service.balanceMicros("user")).periodicMicros,
        "19000000",
      );
      now = new Date("2026-10-09T00:00:00.000Z");
      await service.balanceMicros("user");
      const filter = {
        from: "2026-10-01T00:00:00.000Z",
        to: "2026-10-12T00:00:00.000Z",
        asOf: now.toISOString(),
        tier: "all" as const,
        sandbox: false,
      };
      const source = await store.readUsageReport(filter),
        report = buildUsageReport(source, filter);
      assert.equal(source.events.length, 1);
      assert.equal(report.summary.chargedPoints, 1);
      assert.equal(report.summary.payingUsers, 1);
      assert.equal(report.money.length, 2);
      assert.equal(report.money[0].grossMinor, 3900);
      assert.equal(report.money[1].refundMinor, 1950);
      assert.equal(report.tiers[0].p50, 1);
      assert.equal(report.tiers[0].windows, 1);
      const detail = await store.readUsageReport({
        ...filter,
        userId: "other",
      });
      assert.equal(detail.events.length, 0);
      assert.equal(detail.payments.length, 1);
      assert.equal(detail.payments[0].currency, "USD");
      console.log(
        JSON.stringify({
          evidence: "usage-postgres",
          schema,
          migration: "075 applied twice",
          rollback: "duplicate event rolls back debit",
          chargedPoints: report.summary.chargedPoints,
          payments: "pending excluded / sandbox isolated",
        }),
      );
    } finally {
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pool.end();
    }
  },
);
