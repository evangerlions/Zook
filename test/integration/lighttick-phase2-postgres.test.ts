import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickReviewService } from "../../src/modules/lighttick/lighttick-review.service.ts";
import { LightTickDeepReviewService } from "../../src/modules/lighttick/lighttick-deep-review.service.ts";

const url = process.env.LIGHTTICK_TEST_DATABASE_URL;
test("Phase 2 PostgreSQL decisions are atomic and DNA evidence survives migration replay", { skip: !url }, async () => {
  const admin = new Pool({ connectionString: url });
  const schema = `lighttick_phase2_${Date.now()}`;
  const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 6 });
  const owner = { appId: "lighttick" as const, userId: "phase2_user" };
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    const migrations = ["029_lighttick_core.sql", "030_lighttick_events_reviews_ai.sql", "031_lighttick_sync_devices.sql",
      "032_lighttick_progressive_action_loop.sql", "037_lighttick_dna_insights.sql", "058_lighttick_dna_evidence.sql"];
    for (const name of migrations) await pool.query(await readFile(new URL(`../../src/infrastructure/database/postgres/migrations/${name}`, import.meta.url), "utf8"));
    const repository = new PostgresLightTickRepository(pool);
    const goal = await new LightTickGoalService(repository).create(owner, { title: "Study", constraints: {} });
    const makeReview = async () => {
      const review = await new LightTickReviewService(repository).create(owner, goal.id, "week", "2026-08-31", "2026-09-06");
      return await repository.saveReview({ ...review, output: { recommendations: [{ id: "r1", title: "Study less" }] } });
    };
    const review = await makeReview();
    const service = new LightTickDeepReviewService(repository);
    const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => service.apply(owner, review.id, "accept_all")));
    assert.equal(attempts.filter(item => item.status === "fulfilled").length, 1);
    assert.equal((await repository.listPlans(owner, goal.id)).length, 1);
    const next = await makeReview();
    // Force a genuine SQL failure after plan creation, without replacing service behavior.
    await pool.query(`ALTER TABLE zook_lighttick_reviews ADD CONSTRAINT reject_next_action
      CHECK (id <> '${next.id}' OR NOT (output ? 'action_state'))`);
    await assert.rejects(service.apply(owner, next.id, "accept_all"));
    assert.equal((await repository.listPlans(owner, goal.id)).length, 1);
    assert.equal((await repository.listReviews(owner)).find(item => item.id === next.id)!.output.action_state, undefined);
    const now = new Date().toISOString();
    const insight = await repository.saveDnaInsight({ ...owner, id: "dna_probe", signature: "rule:Study", ruleId: "rule.time_estimation_bias",
      statement: "Less time", kind: "rule", status: "proposed", evidenceCount: 7, dataRange: { from: now, to: now },
      confidence: 0.7, scope: "task_type", allowedEffects: [], evidence: { deviation_minutes: -70 },
      version: 1, createdAt: now, updatedAt: now, expiresAt: now });
    const confirmed = await repository.saveDnaInsight({ ...insight, status: "confirmed" }, insight.version);
    await pool.query(await readFile(new URL("../../src/infrastructure/database/postgres/migrations/058_lighttick_dna_evidence.sql", import.meta.url), "utf8"));
    assert.equal((await repository.getDnaInsight(owner, confirmed.id))?.evidence?.deviation_minutes, -70);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
