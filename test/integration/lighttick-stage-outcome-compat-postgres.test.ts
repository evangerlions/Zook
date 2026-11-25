import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { GoalRoadmapService } from "../../src/modules/lighttick/planning/goal-roadmap.ts";

const databaseUrl = process.env.LIGHTTICK_TEST_DATABASE_URL?.trim();
if (!databaseUrl || !["127.0.0.1", "localhost"].includes(new URL(databaseUrl).hostname) ||
  !new URL(databaseUrl).pathname.startsWith("/lighttick_stage_outcome_")) {
  throw Error("Use a disposable local LightTick stage outcome compatibility database migrated to 127.");
}

test("an existing milestone and staged outcome corrections coexist through migration and guest upgrade", async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const repo = new PostgresLightTickRepository(pool);
  const now = "2026-11-23T03:00:00.000Z";
  const guest = { appId: "lighttick", userId: "stage-evidence-legacy-guest" } as const;
  const target = { appId: "lighttick", userId: "stage-evidence-registered" } as const;
  const stageId = "practice-stage";
  try {
    const baseline = await pool.query(`SELECT name FROM zook_schema_migrations ORDER BY name DESC LIMIT 1`);
    assert.match(baseline.rows[0]?.name, /^127_/, "Legacy evidence must be seeded before applying migration 128.");
    await pool.query(`INSERT INTO zook_users (id,password_hash,password_algo,status) VALUES
      ($1,'fixture-guest','lighttick-guest','ACTIVE'),($2,'fixture-registered','scrypt','ACTIVE')`, [guest.userId, target.userId]);
    await pool.query(`INSERT INTO zook_app_users (id,app_id,user_id,status) VALUES
      ('stage-evidence-app-guest','lighttick',$1,'ACTIVE'),('stage-evidence-app-registered','lighttick',$2,'ACTIVE')`, [guest.userId, target.userId]);
    await repo.saveGuestIdentity({ ...guest, deviceId: "stage-evidence-fixture-device", deviceSecretHash: "fixture-device",
      platform: "ios", timezone: "Asia/Shanghai", locale: "zh-CN", appVersion: "1", upgradeTokenHash: "fixture-proof",
      expiresAt: "2099-01-01T00:00:00Z", createdAt: now, updatedAt: now });
    const clock = () => new Date(now);
    const goal = await new LightTickGoalService(repo, clock).create(guest, { title: "阶段记录迁移", constraints: {} });
    await new GoalRoadmapService(repo, clock).update(guest, goal.id, { base_version: 0, stages: [{ id: stageId, title: "汇报练习",
      starts_on: "2026-11-01", ends_on: "2026-11-30", outcome_criteria: "能举一个实际例子" }] });
    await pool.query(`INSERT INTO zook_lighttick_milestones (id,app_id,user_id,goal_id,title,observable_criteria)
      VALUES ('legacy-milestone','lighttick',$1,$2,'旧里程碑','留下一条记录')`, [guest.userId, goal.id]);
    await pool.query(`INSERT INTO zook_lighttick_outcome_evidence
      (id,app_id,user_id,goal_id,milestone_id,kind,value,source,confirmed,occurred_at)
      VALUES ('legacy-outcome','lighttick',$1,$2,'legacy-milestone','text','{"value":"原始成果"}','user',true,$3)`,
    [guest.userId, goal.id, now]);
    await runPostgresMigrations({ connectionString: databaseUrl, log: () => {} });
    const legacy = await pool.query(`SELECT milestone_id,roadmap_stage_id,value FROM zook_lighttick_outcome_evidence WHERE id='legacy-outcome'`);
    assert.deepEqual(legacy.rows, [{ milestone_id: "legacy-milestone", roadmap_stage_id: null, value: { value: "原始成果" } }]);

    await pool.query(`INSERT INTO zook_lighttick_outcome_evidence
      (id,app_id,user_id,goal_id,roadmap_stage_id,occurred_on,metric,kind,value,source,confirmed,occurred_at,version,corrected_from)
      VALUES ('stage-original','lighttick',$1,$2,$3,'2026-11-22','汇报信心','number','{"value":6,"unit":"分"}','user',true,$4,1,NULL),
             ('stage-corrected','lighttick',$1,$2,$3,'2026-11-22','汇报信心','number','{"value":5,"unit":"分"}','user',true,$4,2,'stage-original')`,
    [guest.userId, goal.id, stageId, now]);
    const command = { appId: "lighttick", operationId: "stage-outcome-fixture-upgrade", requestHash: "fixture-request",
      guestUserId: guest.userId, targetUserId: target.userId, guestUpgradeTokenHash: "fixture-proof",
      deviceId: "stage-evidence-fixture-device", now } as const;
    await pool.query(`UPDATE zook_lighttick_outcome_evidence SET roadmap_stage_id='missing-stage' WHERE id='stage-corrected'`);
    await assert.rejects(repo.upgradeGuestAccount(command), { code: "LIGHTTICK_GUEST_UPGRADE_CONFLICT" });
    const unchanged = await pool.query(`SELECT DISTINCT user_id FROM zook_lighttick_outcome_evidence WHERE goal_id=$1`, [goal.id]);
    assert.deepEqual(unchanged.rows, [{ user_id: guest.userId }]);
    await pool.query(`UPDATE zook_lighttick_outcome_evidence SET roadmap_stage_id=$1 WHERE id='stage-corrected'`, [stageId]);

    assert.equal((await repo.upgradeGuestAccount(command)).idempotencyReplayed, false);
    assert.equal((await repo.upgradeGuestAccount(command)).idempotencyReplayed, true);
    const stored = await pool.query(`SELECT id,user_id,roadmap_stage_id,milestone_id,occurred_on::text,corrected_from,value
      FROM zook_lighttick_outcome_evidence WHERE goal_id=$1 ORDER BY id`, [goal.id]);
    assert.deepEqual(stored.rows, [
      { id: "legacy-outcome", user_id: target.userId, roadmap_stage_id: null, milestone_id: "legacy-milestone",
        occurred_on: null, corrected_from: null, value: { value: "原始成果" } },
      { id: "stage-corrected", user_id: target.userId, roadmap_stage_id: stageId, milestone_id: null,
        occurred_on: "2026-11-22", corrected_from: "stage-original", value: { value: 5, unit: "分" } },
      { id: "stage-original", user_id: target.userId, roadmap_stage_id: stageId, milestone_id: null,
        occurred_on: "2026-11-22", corrected_from: null, value: { value: 6, unit: "分" } },
    ]);
    await repo.deleteOwnerData(target);
    assert.equal((await pool.query("SELECT id FROM zook_lighttick_outcome_evidence WHERE goal_id=$1", [goal.id])).rowCount, 0);
  } finally { await pool.end(); }
});
