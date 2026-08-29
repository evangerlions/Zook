import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import type { LightTickAtomicWrite } from "../../src/modules/lighttick/lighttick.repository.ts";
import type { LightTickGoalRow, LightTickGuestIdentityRow } from "../../src/modules/lighttick/lighttick.types.ts";

const databaseUrl = process.env.LIGHTTICK_TEST_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("LIGHTTICK_TEST_DATABASE_URL must point to a disposable PostgreSQL database.");
const owner = { appId: "lighttick", userId: "lighttick_pg_user" } as const;
const now = "2026-08-20T00:00:00.000Z";
const goal = (title: string): LightTickGoalRow => ({ ...owner, id: "lighttick_pg_goal", title,
  status: "active", constraints: {}, version: 1, createdAt: now, updatedAt: now });
const write = (suffix: string, version: number): LightTickAtomicWrite => ({
  event: { ...owner, id: `lighttick_pg_event_${suffix}`, aggregateType: "goal", aggregateId: "lighttick_pg_goal",
    eventType: "goal_updated", aggregateVersion: version, payload: {}, occurredAt: now, createdAt: now },
  change: { ...owner, entityType: "goal", entityId: "lighttick_pg_goal", entityVersion: version,
    operation: "upsert", snapshot: { suffix }, changedAt: now },
});

test("LightTick PostgreSQL migrations, ownership indexes, transactions, and concurrent CAS", async (suite) => {
  await runPostgresMigrations({ connectionString: databaseUrl, log: () => undefined });
  const pool = new Pool({ connectionString: databaseUrl, max: 6 });
  const repository = new PostgresLightTickRepository(pool);
  try {
    await pool.query("DELETE FROM zook_lighttick_execution_events WHERE user_id=$1", [owner.userId]);
    await pool.query("DELETE FROM zook_lighttick_change_log WHERE user_id=$1", [owner.userId]);
    await pool.query("DELETE FROM zook_lighttick_goals WHERE user_id=$1", [owner.userId]);
    await pool.query("DELETE FROM zook_lighttick_profiles WHERE user_id=$1", [owner.userId]);
    await pool.query("DELETE FROM zook_lighttick_guest_identities WHERE user_id=$1 OR device_id='lighttick_pg_device'", [owner.userId]);

    await suite.test("installs from empty and remains upgrade/idempotency safe", async () => {
      const installed = await pool.query(`SELECT name FROM zook_schema_migrations
        WHERE name LIKE '029_lighttick%' OR name LIKE '030_lighttick%' OR name LIKE '031_lighttick%'
          OR name LIKE '032_lighttick%' OR name LIKE '033_lighttick%' OR name LIKE '034_lighttick%' ORDER BY name`);
      assert.deepEqual(installed.rows.map(row => row.name), [
        "029_lighttick_core.sql", "030_lighttick_events_reviews_ai.sql", "031_lighttick_sync_devices.sql",
        "032_lighttick_progressive_action_loop.sql", "033_lighttick_guest_identities.sql",
        "034_lighttick_account_upgrades.sql",
      ]);
      const before = installed.rows.length;
      await runPostgresMigrations({ connectionString: databaseUrl, log: () => undefined });
      const after = await pool.query(`SELECT COUNT(*)::int AS count FROM zook_schema_migrations
        WHERE name LIKE '%lighttick%'`);
      assert.equal(after.rows[0].count, before);
    });

    await suite.test("creates owner and sync indexes", async () => {
      const indexes = await pool.query(`SELECT indexname,indexdef FROM pg_indexes
        WHERE schemaname=current_schema() AND indexname LIKE 'zook_lighttick_%'`);
      const definitions = indexes.rows.map(row => row.indexdef).join("\n");
      assert.match(definitions, /app_id, user_id/);
      assert.match(definitions, /zook_lighttick_changes_owner_sequence_idx/);
      assert.match(definitions, /zook_lighttick_operations_pkey/);
      assert.match(definitions, /zook_lighttick_devices_active_token_uidx/);
      assert.match(definitions, /zook_lighttick_tasks_owner_lineage_idx/);
      assert.match(definitions, /zook_lighttick_guest_expiry_idx/);
      assert.match(definitions, /zook_lighttick_account_upgrades_pkey/);
    });

    await suite.test("persists and recovers a device-bound guest identity", async () => {
      const guest: LightTickGuestIdentityRow = { ...owner, deviceId: "lighttick_pg_device",
        deviceSecretHash: "secret_hash", platform: "ios", timezone: "Asia/Shanghai", locale: "zh-CN",
        appVersion: "1.0.0", upgradeTokenHash: "upgrade_hash", expiresAt: "2026-09-20T00:00:00.000Z",
        createdAt: now, updatedAt: now };
      await repository.saveGuestIdentity(guest);
      assert.equal((await repository.getGuestIdentity(owner))?.deviceSecretHash, "secret_hash");
      assert.equal((await repository.getGuestIdentityByDevice("lighttick_pg_device"))?.userId, owner.userId);
    });

    await suite.test("rolls back failed owner transactions", async () => {
      await assert.rejects(repository.transaction(owner, async () => {
        await repository.saveProfile({ ...owner, timezone: "Asia/Shanghai", locale: "zh-CN", pace: "balanced",
          onboardingState: "drafting", notificationPreferences: {}, onboardingDraft: {}, version: 1,
          createdAt: now, updatedAt: now });
        throw new Error("force rollback");
      }), /force rollback/);
      assert.equal(await repository.getProfile(owner), undefined);
    });

    await suite.test("upgrades guest ownership atomically and replays the original result", async () => {
      const guestUserId = "lighttick_pg_upgrade_guest"; const targetUserId = "lighttick_pg_upgrade_target";
      await pool.query("DELETE FROM zook_lighttick_account_upgrades WHERE guest_user_id=$1", [guestUserId]);
      for (const table of ["zook_lighttick_operations","zook_lighttick_change_log","zook_lighttick_execution_events",
        "zook_lighttick_goals","zook_lighttick_profiles","zook_lighttick_guest_identities"])
        await pool.query(`DELETE FROM ${table} WHERE user_id IN ($1,$2)`, [guestUserId,targetUserId]);
      await pool.query("DELETE FROM zook_app_users WHERE app_id='lighttick' AND user_id IN ($1,$2)", [guestUserId,targetUserId]);
      await pool.query("DELETE FROM zook_users WHERE id IN ($1,$2)", [guestUserId,targetUserId]);
      await pool.query(`INSERT INTO zook_users (id,password_hash,password_algo,status) VALUES
        ($1,'guest','lighttick-guest','ACTIVE'),($2,'formal','scrypt','ACTIVE')`, [guestUserId,targetUserId]);
      await pool.query(`INSERT INTO zook_app_users (id,app_id,user_id,status) VALUES
        ('app_user_pg_guest','lighttick',$1,'ACTIVE'),('app_user_pg_target','lighttick',$2,'ACTIVE')`, [guestUserId,targetUserId]);
      const guestOwner = { appId: "lighttick", userId: guestUserId } as const;
      const targetOwner = { appId: "lighttick", userId: targetUserId } as const;
      await repository.saveGuestIdentity({ ...guestOwner, deviceId: "lighttick_pg_upgrade_device",
        deviceSecretHash: "secret", platform: "ios", timezone: "Asia/Shanghai", locale: "zh-CN",
        appVersion: "1", upgradeTokenHash: "upgrade-proof", expiresAt: "2099-01-01T00:00:00.000Z",
        createdAt: now, updatedAt: now });
      await repository.saveGoal({ ...goal("upgrade-me"), ...guestOwner, id: "lighttick_pg_upgrade_goal" }, {
        event: { ...guestOwner, id: "lighttick_pg_upgrade_event", aggregateType: "goal",
          aggregateId: "lighttick_pg_upgrade_goal", eventType: "goal_created", aggregateVersion: 1,
          payload: {}, occurredAt: now, createdAt: now },
        change: { ...guestOwner, entityType: "goal", entityId: "lighttick_pg_upgrade_goal",
          entityVersion: 1, operation: "upsert", snapshot: {}, changedAt: now },
      });
      const command = { appId: "lighttick", operationId: "lighttick-pg-upgrade-operation", requestHash: "request-hash",
        guestUserId, targetUserId, guestUpgradeTokenHash: "upgrade-proof", deviceId: "lighttick_pg_upgrade_device",
        now: "2026-08-29T00:00:00.000Z" } as const;
      const upgraded = await repository.upgradeGuestAccount(command);
      assert.equal(upgraded.transferredResourceCounts.goals, 1);
      assert.equal((await repository.getGoal(targetOwner, "lighttick_pg_upgrade_goal"))?.userId, targetUserId);
      assert.equal((await repository.getGuestIdentity(guestOwner))?.upgradedToUserId, targetUserId);
      assert.equal((await repository.upgradeGuestAccount(command)).idempotencyReplayed, true);
      const mismatch = { ...command, requestHash: "changed-request" };
      await assert.rejects(repository.upgradeGuestAccount(mismatch), (error: any) => error.code === "LIGHTTICK_IDEMPOTENCY_MISMATCH");
      await repository.deleteOwnerData(targetOwner);
      assert.equal(await repository.getGoal(targetOwner, "lighttick_pg_upgrade_goal"), undefined);
      assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM zook_lighttick_account_upgrades WHERE target_user_id=$1",
        [targetUserId])).rows[0].count, 0);
      for (const table of ["zook_lighttick_change_log","zook_lighttick_execution_events","zook_lighttick_goals",
        "zook_lighttick_profiles","zook_lighttick_guest_identities"])
        await pool.query(`DELETE FROM ${table} WHERE user_id IN ($1,$2)`, [guestUserId,targetUserId]);
      await pool.query("DELETE FROM zook_app_users WHERE app_id='lighttick' AND user_id IN ($1,$2)", [guestUserId,targetUserId]);
      await pool.query("DELETE FROM zook_users WHERE id IN ($1,$2)", [guestUserId,targetUserId]);
    });

    await suite.test("rejects a guest aggregate that references a third-party owner and rolls back", async () => {
      const guestUserId = "lighttick_pg_security_guest";
      const targetUserId = "lighttick_pg_security_target";
      const thirdUserId = "lighttick_pg_security_third";
      const userIds = [guestUserId, targetUserId, thirdUserId];
      try {
        await pool.query(`INSERT INTO zook_users (id,password_hash,password_algo,status) VALUES
          ($1,'guest','lighttick-guest','ACTIVE'),($2,'formal','scrypt','ACTIVE'),($3,'third','scrypt','ACTIVE')
          ON CONFLICT (id) DO NOTHING`, userIds);
        await pool.query(`INSERT INTO zook_app_users (id,app_id,user_id,status) VALUES
          ('app_user_pg_security_guest','lighttick',$1,'ACTIVE'),
          ('app_user_pg_security_target','lighttick',$2,'ACTIVE'),
          ('app_user_pg_security_third','lighttick',$3,'ACTIVE') ON CONFLICT DO NOTHING`, userIds);
        await repository.saveGuestIdentity({ appId: "lighttick", userId: guestUserId,
          deviceId: "lighttick_pg_security_device", deviceSecretHash: "secret", platform: "android",
          timezone: "Asia/Shanghai", locale: "zh-CN", appVersion: "1", upgradeTokenHash: "security-proof",
          expiresAt: "2099-01-01T00:00:00.000Z", createdAt: now, updatedAt: now });
        await pool.query(`INSERT INTO zook_lighttick_goals
          (id,app_id,user_id,title,status,constraints,version,created_at,updated_at)
          VALUES ('lighttick_pg_third_goal','lighttick',$1,'third goal','active','{}',1,$2,$2)`, [thirdUserId, now]);
        await pool.query(`INSERT INTO zook_lighttick_plan_cycles
          (id,app_id,user_id,goal_id,granularity,status,source,period_start,period_end,proposal,version,created_at,updated_at)
          VALUES ('lighttick_pg_foreign_plan','lighttick',$1,'lighttick_pg_third_goal','week','active','user',
          '2026-08-24','2026-08-30','{}',1,$2,$2)`, [guestUserId, now]);

        await assert.rejects(repository.upgradeGuestAccount({ appId: "lighttick",
          operationId: "lighttick-pg-security-upgrade", requestHash: "security-request", guestUserId,
          targetUserId, guestUpgradeTokenHash: "security-proof", deviceId: "lighttick_pg_security_device",
          now: "2026-08-29T00:00:00.000Z" }),
        (error: any) => error.code === "LIGHTTICK_GUEST_UPGRADE_CONFLICT");
        assert.equal((await pool.query("SELECT user_id FROM zook_lighttick_plan_cycles WHERE id='lighttick_pg_foreign_plan'"))
          .rows[0]?.user_id, guestUserId);
        assert.equal((await repository.getGuestIdentity({ appId: "lighttick", userId: guestUserId }))?.revokedAt, null);
      } finally {
        await pool.query("DELETE FROM zook_lighttick_plan_cycles WHERE id='lighttick_pg_foreign_plan'");
        await pool.query("DELETE FROM zook_lighttick_goals WHERE id='lighttick_pg_third_goal'");
        await pool.query("DELETE FROM zook_lighttick_guest_identities WHERE user_id=$1", [guestUserId]);
        await pool.query("DELETE FROM zook_lighttick_account_upgrades WHERE operation_id='lighttick-pg-security-upgrade'");
        await pool.query("DELETE FROM zook_app_users WHERE app_id='lighttick' AND user_id=ANY($1::text[])", [userIds]);
        await pool.query("DELETE FROM zook_users WHERE id=ANY($1::text[])", [userIds]);
      }
    });

    await suite.test("allows exactly one concurrent update for one base version", async () => {
      await repository.saveGoal(goal("base"), write("create", 1));
      const outcomes = await Promise.allSettled([
        repository.saveGoal(goal("left"), write("left", 2), 1),
        repository.saveGoal(goal("right"), write("right", 2), 1),
      ]);
      assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
      const rejected = outcomes.find(result => result.status === "rejected") as PromiseRejectedResult;
      assert.equal(rejected.reason.code, "LIGHTTICK_VERSION_CONFLICT");
      const stored = await repository.getGoal(owner, "lighttick_pg_goal");
      assert.equal(stored?.version, 2);
      const events = await pool.query(`SELECT id FROM zook_lighttick_execution_events
        WHERE app_id=$1 AND user_id=$2 AND aggregate_id='lighttick_pg_goal'`, [owner.appId,owner.userId]);
      assert.equal(events.rowCount, 2);
    });
  } finally {
    await pool.query("DELETE FROM zook_lighttick_execution_events WHERE user_id=$1", [owner.userId]).catch(() => undefined);
    await pool.query("DELETE FROM zook_lighttick_change_log WHERE user_id=$1", [owner.userId]).catch(() => undefined);
    await pool.query("DELETE FROM zook_lighttick_goals WHERE user_id=$1", [owner.userId]).catch(() => undefined);
    await pool.query("DELETE FROM zook_lighttick_profiles WHERE user_id=$1", [owner.userId]).catch(() => undefined);
    await pool.query("DELETE FROM zook_lighttick_guest_identities WHERE user_id=$1 OR device_id='lighttick_pg_device'", [owner.userId]).catch(() => undefined);
    await pool.end();
  }
});
